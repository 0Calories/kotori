import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// A fresh start for Postgres: the SQLite databases predate the beta and are
// re-seeded (JMDict) or re-generated (enrichment), not migrated. Timestamps
// are millisecond epochs in BIGINT, matching what the code already stores.

const dictionary = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Seeded from JMDict. `priority` folds JMDict's frequency markers (news1, ichi1, nf01…)
  // into one number so search and enrichment can favour words people actually use.
  yield* sql`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      headword TEXT NOT NULL,
      reading TEXT NOT NULL,
      common BOOLEAN NOT NULL DEFAULT FALSE,
      priority INTEGER NOT NULL DEFAULT 0
    )
  `
  yield* sql`CREATE INDEX entries_priority ON entries (priority DESC, id)`

  // `text` collates in "C" (byte order, as SQLite compared it) so the prefix
  // search's range scan stays correct and indexable under any locale.
  yield* sql`
    CREATE TABLE forms (
      entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('kanji', 'kana')),
      position INTEGER NOT NULL,
      text TEXT COLLATE "C" NOT NULL,
      common BOOLEAN NOT NULL DEFAULT FALSE,
      tags TEXT NOT NULL DEFAULT '[]',
      priorities TEXT NOT NULL DEFAULT '[]',
      restrictions TEXT NOT NULL DEFAULT '[]',
      no_kanji BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (entry_id, kind, position)
    )
  `
  yield* sql`CREATE INDEX forms_text ON forms (text)`

  yield* sql`
    CREATE TABLE senses (
      entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      glosses TEXT NOT NULL,
      pos TEXT NOT NULL DEFAULT '[]',
      misc TEXT NOT NULL DEFAULT '[]',
      fields TEXT NOT NULL DEFAULT '[]',
      dialects TEXT NOT NULL DEFAULT '[]',
      info TEXT NOT NULL DEFAULT '[]',
      stagk TEXT NOT NULL DEFAULT '[]',
      stagr TEXT NOT NULL DEFAULT '[]',
      xrefs TEXT NOT NULL DEFAULT '[]',
      antonyms TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (entry_id, position)
    )
  `

  // One row per English gloss. `norm` ("to eat (a meal)" -> "eat") supports exact
  // matching for EN->JP lookups and finding words that share a meaning. `ts` is
  // the full-text index over the gloss, kept current by Postgres itself.
  yield* sql`
    CREATE TABLE glosses (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      sense INTEGER NOT NULL,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      norm TEXT NOT NULL,
      ts tsvector NOT NULL GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
    )
  `
  yield* sql`CREATE INDEX glosses_entry ON glosses (entry_id, sense)`
  yield* sql`CREATE INDEX glosses_norm ON glosses (norm)`
  yield* sql`CREATE INDEX glosses_ts ON glosses USING gin (ts)`

  yield* sql`CREATE TABLE tags (code TEXT PRIMARY KEY, label TEXT NOT NULL)`
})

const enrichment = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Jev's nuance judgments per sense. `answers` keeps the raw distributions so
  // thresholds and labels can be re-derived without paying for inference again.
  yield* sql`
    CREATE TABLE sense_nuance (
      entry_id INTEGER NOT NULL,
      sense INTEGER NOT NULL,
      nuance TEXT NOT NULL,
      answers TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (entry_id, sense)
    )
  `

  yield* sql`
    CREATE TABLE similar_words (
      entry_id INTEGER NOT NULL,
      sense INTEGER NOT NULL,
      similar_id INTEGER NOT NULL,
      similarity DOUBLE PRECISION NOT NULL,
      difference TEXT NOT NULL,
      confidence DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (entry_id, sense, similar_id)
    )
  `

  yield* sql`
    CREATE TABLE examples (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      sense INTEGER NOT NULL,
      position INTEGER NOT NULL,
      ja TEXT NOT NULL,
      furigana TEXT NOT NULL,
      en TEXT NOT NULL,
      formality TEXT NOT NULL,
      note TEXT,
      model TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  yield* sql`CREATE INDEX examples_entry ON examples (entry_id, sense, position)`

  // Content-addressed audio clips: key = sha256(voice, model, text). The bytes
  // live in `audio_files` so the API and the worker share them without a disk.
  yield* sql`
    CREATE TABLE audio (
      key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      language TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      characters INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  yield* sql`CREATE TABLE audio_files (key TEXT PRIMARY KEY, data BYTEA NOT NULL)`
  yield* sql`CREATE TABLE entry_audio (entry_id INTEGER PRIMARY KEY, audio_key TEXT NOT NULL)`
  yield* sql`
    CREATE TABLE example_audio (
      example_id INTEGER NOT NULL,
      language TEXT NOT NULL,
      audio_key TEXT NOT NULL,
      PRIMARY KEY (example_id, language)
    )
  `

  // Work queue shared by the API (on-demand requests) and the worker.
  yield* sql`
    CREATE TABLE jobs (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      run_after BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (kind, entry_id)
    )
  `
  yield* sql`CREATE INDEX jobs_pending ON jobs (status, priority DESC, run_after)`
})

const study = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // The learner profile. Identity (email, credentials, sessions) lives in Better
  // Auth's own tables; `id` is its user id, and the row is created on first request.
  yield* sql`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      native_language TEXT NOT NULL DEFAULT 'en',
      target_language TEXT NOT NULL DEFAULT 'ja',
      onboarded_at BIGINT,
      display_name TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      daily_new_limit INTEGER NOT NULL DEFAULT 20,
      daily_review_limit INTEGER NOT NULL DEFAULT 200,
      created_at BIGINT NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      entry_id INTEGER,
      sense INTEGER,
      created_at BIGINT NOT NULL
    )
  `
  yield* sql`CREATE INDEX notes_user ON notes (user_id, created_at)`
  yield* sql`CREATE UNIQUE INDEX notes_word ON notes (user_id, entry_id, sense) WHERE entry_id IS NOT NULL`

  yield* sql`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      template TEXT NOT NULL,
      queue TEXT NOT NULL,
      due BIGINT NOT NULL,
      interval INTEGER NOT NULL DEFAULT 0,
      ease DOUBLE PRECISION NOT NULL DEFAULT 0,
      step INTEGER NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      leech BOOLEAN NOT NULL DEFAULT FALSE,
      last_review BIGINT,
      seed INTEGER NOT NULL,
      position INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  yield* sql`CREATE INDEX cards_queue ON cards (user_id, queue, due)`
  yield* sql`CREATE INDEX cards_note ON cards (note_id)`

  yield* sql`
    CREATE TABLE review_logs (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      queue_before TEXT NOT NULL,
      interval_before INTEGER NOT NULL,
      interval INTEGER NOT NULL,
      ease_before DOUBLE PRECISION NOT NULL,
      ease DOUBLE PRECISION NOT NULL,
      delay BIGINT NOT NULL,
      duration_ms INTEGER,
      reviewed_at BIGINT NOT NULL,
      study_day INTEGER NOT NULL
    )
  `
  yield* sql`CREATE INDEX review_logs_user_day ON review_logs (user_id, study_day)`

  // Coach results are cached by request, and usage is tracked for rate limiting.
  yield* sql`
    CREATE TABLE coach_cache (
      key TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE coach_usage (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `
  yield* sql`CREATE INDEX coach_usage_user ON coach_usage (user_id, created_at)`
})

// Identity moved to Neon's Managed Better Auth (`neon_auth` schema, same database).
// Its user record has no custom fields, so the approval state and the role Kotori
// cares about live on the learner profile instead.
const accounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    ALTER TABLE users
      ADD COLUMN status TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  `
  yield* sql`CREATE INDEX users_status ON users (status)`
})

export const migrations = {
  "0001_dictionary": dictionary,
  "0002_enrichment": enrichment,
  "0003_study": study,
  "0004_accounts": accounts
}
