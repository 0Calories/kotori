import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// Kotori went to Postgres before its first learner, so the schema starts here in
// one migration rather than replaying the SQLite history. Conventions:
//   - times are `bigint` milliseconds since the epoch (the API works in numbers)
//   - JMDict's lists are `jsonb`, written as JSON strings and read back as values
//   - Better Auth's tables (`user`, `session`, `account`, `verification`) live in
//     the same database but are created and migrated by Better Auth itself
const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // --- Dictionary, seeded from JMDict. `priority` folds JMDict's frequency markers
  // (news1, ichi1, nf01…) into one number so search and enrichment can favour words
  // people actually use.
  yield* sql`
    CREATE TABLE entries (
      id integer PRIMARY KEY,
      headword text NOT NULL,
      reading text NOT NULL,
      common boolean NOT NULL DEFAULT false,
      priority integer NOT NULL DEFAULT 0
    )
  `
  yield* sql`CREATE INDEX entries_priority ON entries (priority DESC, id)`

  // `text` compares bytewise (COLLATE "C") so a prefix search is an index range scan.
  yield* sql`
    CREATE TABLE forms (
      entry_id integer NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('kanji', 'kana')),
      position integer NOT NULL,
      text text COLLATE "C" NOT NULL,
      common boolean NOT NULL DEFAULT false,
      tags jsonb NOT NULL DEFAULT '[]',
      priorities jsonb NOT NULL DEFAULT '[]',
      restrictions jsonb NOT NULL DEFAULT '[]',
      no_kanji boolean NOT NULL DEFAULT false,
      PRIMARY KEY (entry_id, kind, position)
    )
  `
  yield* sql`CREATE INDEX forms_text ON forms (text)`

  yield* sql`
    CREATE TABLE senses (
      entry_id integer NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      position integer NOT NULL,
      glosses jsonb NOT NULL,
      pos jsonb NOT NULL DEFAULT '[]',
      misc jsonb NOT NULL DEFAULT '[]',
      fields jsonb NOT NULL DEFAULT '[]',
      dialects jsonb NOT NULL DEFAULT '[]',
      info jsonb NOT NULL DEFAULT '[]',
      stagk jsonb NOT NULL DEFAULT '[]',
      stagr jsonb NOT NULL DEFAULT '[]',
      xrefs jsonb NOT NULL DEFAULT '[]',
      antonyms jsonb NOT NULL DEFAULT '[]',
      PRIMARY KEY (entry_id, position)
    )
  `

  // One row per English gloss. `norm` ("to eat (a meal)" -> "eat") supports exact
  // matching for EN->JP lookups and finding words that share a meaning; `search`
  // is the stemmed full-text index behind fuzzy English search.
  yield* sql`
    CREATE TABLE glosses (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_id integer NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      sense integer NOT NULL,
      position integer NOT NULL,
      text text NOT NULL,
      norm text NOT NULL,
      search tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
    )
  `
  yield* sql`CREATE INDEX glosses_entry ON glosses (entry_id, sense)`
  yield* sql`CREATE INDEX glosses_norm ON glosses (norm)`
  yield* sql`CREATE INDEX glosses_search ON glosses USING gin (search)`

  yield* sql`CREATE TABLE tags (code text PRIMARY KEY, label text NOT NULL)`

  // --- Enrichment. Jev's nuance judgments per sense; `answers` keeps the raw
  // distributions so thresholds and labels can be re-derived without paying for
  // inference again.
  yield* sql`
    CREATE TABLE sense_nuance (
      entry_id integer NOT NULL,
      sense integer NOT NULL,
      nuance jsonb NOT NULL,
      answers jsonb NOT NULL,
      model text NOT NULL,
      created_at bigint NOT NULL,
      PRIMARY KEY (entry_id, sense)
    )
  `

  yield* sql`
    CREATE TABLE similar_words (
      entry_id integer NOT NULL,
      sense integer NOT NULL,
      similar_id integer NOT NULL,
      similarity double precision NOT NULL,
      difference text NOT NULL,
      confidence double precision NOT NULL,
      PRIMARY KEY (entry_id, sense, similar_id)
    )
  `

  yield* sql`
    CREATE TABLE examples (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      entry_id integer NOT NULL,
      sense integer NOT NULL,
      position integer NOT NULL,
      ja text NOT NULL,
      furigana text NOT NULL,
      en text NOT NULL,
      formality text NOT NULL,
      note text,
      model text NOT NULL,
      created_at bigint NOT NULL
    )
  `
  yield* sql`CREATE INDEX examples_entry ON examples (entry_id, sense, position)`

  // Content-addressed audio clips: key = sha256(voice, model, text). Metadata and
  // the MP3 bytes are separate so budgeting and lookups never load audio.
  yield* sql`
    CREATE TABLE audio (
      key text PRIMARY KEY,
      text text NOT NULL,
      language text NOT NULL,
      voice_id text NOT NULL,
      model_id text NOT NULL,
      characters integer NOT NULL,
      bytes integer NOT NULL,
      created_at bigint NOT NULL
    )
  `
  yield* sql`CREATE TABLE audio_clips (key text PRIMARY KEY, data bytea NOT NULL)`
  yield* sql`CREATE TABLE entry_audio (entry_id integer PRIMARY KEY, audio_key text NOT NULL)`
  yield* sql`
    CREATE TABLE example_audio (
      example_id integer NOT NULL,
      language text NOT NULL,
      audio_key text NOT NULL,
      PRIMARY KEY (example_id, language)
    )
  `

  // Work queue shared by the API (on-demand requests) and the worker.
  yield* sql`
    CREATE TABLE jobs (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind text NOT NULL,
      entry_id integer NOT NULL,
      priority integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0,
      error text,
      run_after bigint NOT NULL DEFAULT 0,
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      UNIQUE (kind, entry_id)
    )
  `
  yield* sql`CREATE INDEX jobs_pending ON jobs (status, priority DESC, run_after)`

  // --- Learners. `users` is the profile, keyed by the Better Auth user id and
  // created on first request; identity and sessions are Better Auth's.
  yield* sql`
    CREATE TABLE users (
      id text PRIMARY KEY,
      native_language text NOT NULL DEFAULT 'en',
      target_language text NOT NULL DEFAULT 'ja',
      onboarded_at bigint,
      display_name text,
      timezone text NOT NULL DEFAULT 'UTC',
      daily_new_limit integer NOT NULL DEFAULT 20,
      daily_review_limit integer NOT NULL DEFAULT 200,
      created_at bigint NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE notes (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      kind text NOT NULL,
      content jsonb NOT NULL,
      entry_id integer,
      sense integer,
      created_at bigint NOT NULL
    )
  `
  yield* sql`CREATE INDEX notes_user ON notes (user_id, created_at)`
  yield* sql`CREATE UNIQUE INDEX notes_word ON notes (user_id, entry_id, sense) WHERE entry_id IS NOT NULL`

  yield* sql`
    CREATE TABLE cards (
      id text PRIMARY KEY,
      note_id text NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      user_id text NOT NULL,
      template text NOT NULL,
      queue text NOT NULL,
      due bigint NOT NULL,
      "interval" integer NOT NULL DEFAULT 0,
      ease double precision NOT NULL DEFAULT 0,
      step integer NOT NULL DEFAULT 0,
      reps integer NOT NULL DEFAULT 0,
      lapses integer NOT NULL DEFAULT 0,
      leech boolean NOT NULL DEFAULT false,
      last_review bigint,
      seed integer NOT NULL,
      position integer NOT NULL,
      created_at bigint NOT NULL
    )
  `
  yield* sql`CREATE INDEX cards_queue ON cards (user_id, queue, due)`
  yield* sql`CREATE INDEX cards_note ON cards (note_id)`

  yield* sql`
    CREATE TABLE review_logs (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      card_id text NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
      user_id text NOT NULL,
      rating text NOT NULL,
      queue_before text NOT NULL,
      interval_before integer NOT NULL,
      "interval" integer NOT NULL,
      ease_before double precision NOT NULL,
      ease double precision NOT NULL,
      delay integer NOT NULL,
      duration_ms integer,
      reviewed_at bigint NOT NULL,
      study_day integer NOT NULL
    )
  `
  yield* sql`CREATE INDEX review_logs_user_day ON review_logs (user_id, study_day)`

  // Coach results are cached by request, and usage is tracked for rate limiting.
  yield* sql`
    CREATE TABLE coach_cache (
      key text PRIMARY KEY,
      result text NOT NULL,
      created_at bigint NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE coach_usage (
      user_id text NOT NULL,
      kind text NOT NULL,
      created_at bigint NOT NULL
    )
  `
  yield* sql`CREATE INDEX coach_usage_user ON coach_usage (user_id, created_at)`
})

export const migrations = {
  "0001_initial": initial
}
