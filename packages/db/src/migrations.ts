import { Effect } from "effect"
import { SqlClient } from "effect/sql"

const dictionary = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  // Seeded from JMDict. `priority` folds JMDict's frequency markers (news1, ichi1, nf01…)
  // into one number so search and enrichment can favour words people actually use.
  yield* sql`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      headword TEXT NOT NULL,
      reading TEXT NOT NULL,
      common INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0
    )
  `
  yield* sql`CREATE INDEX entries_priority ON entries (priority DESC, id)`

  yield* sql`
    CREATE TABLE forms (
      entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('kanji', 'kana')),
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      common INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      priorities TEXT NOT NULL DEFAULT '[]',
      restrictions TEXT NOT NULL DEFAULT '[]',
      no_kanji INTEGER NOT NULL DEFAULT 0,
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
  // matching for EN->JP lookups and finding words that share a meaning.
  yield* sql`
    CREATE TABLE glosses (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      sense INTEGER NOT NULL,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      norm TEXT NOT NULL
    )
  `
  yield* sql`CREATE INDEX glosses_entry ON glosses (entry_id, sense)`
  yield* sql`CREATE INDEX glosses_norm ON glosses (norm)`
  yield* sql`
    CREATE VIRTUAL TABLE gloss_fts USING fts5 (
      text,
      content = 'glosses',
      content_rowid = 'id',
      tokenize = 'porter unicode61 remove_diacritics 2'
    )
  `

  yield* sql`CREATE TABLE tags (code TEXT PRIMARY KEY, label TEXT NOT NULL)`
})

const enrichment = Effect.gen(function*() {
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
      created_at INTEGER NOT NULL,
      PRIMARY KEY (entry_id, sense)
    )
  `

  yield* sql`
    CREATE TABLE similar_words (
      entry_id INTEGER NOT NULL,
      sense INTEGER NOT NULL,
      similar_id INTEGER NOT NULL,
      similarity REAL NOT NULL,
      difference TEXT NOT NULL,
      confidence REAL NOT NULL,
      PRIMARY KEY (entry_id, sense, similar_id)
    )
  `

  yield* sql`
    CREATE TABLE examples (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL,
      sense INTEGER NOT NULL,
      position INTEGER NOT NULL,
      ja TEXT NOT NULL,
      furigana TEXT NOT NULL,
      en TEXT NOT NULL,
      formality TEXT NOT NULL,
      note TEXT,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`CREATE INDEX examples_entry ON examples (entry_id, sense, position)`

  // Content-addressed audio clips: key = sha256(voice, model, text).
  yield* sql`
    CREATE TABLE audio (
      key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      language TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      characters INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
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
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      entry_id INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      run_after INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (kind, entry_id)
    )
  `
  yield* sql`CREATE INDEX jobs_pending ON jobs (status, priority DESC, run_after)`
})

const study = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      native_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      display_name TEXT,
      timezone TEXT NOT NULL,
      daily_new_limit INTEGER NOT NULL DEFAULT 20,
      daily_review_limit INTEGER NOT NULL DEFAULT 200,
      created_at INTEGER NOT NULL
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
      created_at INTEGER NOT NULL
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
      due INTEGER NOT NULL,
      interval INTEGER NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 0,
      step INTEGER NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      leech INTEGER NOT NULL DEFAULT 0,
      last_review INTEGER,
      seed INTEGER NOT NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`CREATE INDEX cards_queue ON cards (user_id, queue, due)`
  yield* sql`CREATE INDEX cards_note ON cards (note_id)`

  yield* sql`
    CREATE TABLE review_logs (
      id INTEGER PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      queue_before TEXT NOT NULL,
      interval_before INTEGER NOT NULL,
      interval INTEGER NOT NULL,
      ease_before REAL NOT NULL,
      ease REAL NOT NULL,
      delay INTEGER NOT NULL,
      duration_ms INTEGER,
      reviewed_at INTEGER NOT NULL,
      study_day INTEGER NOT NULL
    )
  `
  yield* sql`CREATE INDEX review_logs_user_day ON review_logs (user_id, study_day)`

  // Coach results are cached by request, and usage is tracked for rate limiting.
  yield* sql`
    CREATE TABLE coach_cache (
      key TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE coach_usage (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `
  yield* sql`CREATE INDEX coach_usage_user ON coach_usage (user_id, created_at)`
})

const situations = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  // Prototype situation index. Titles and aliases are generated offline; entry
  // links are real JMDict ids resolved at index time. Vectors live in
  // `situation_embeddings` and, when the extension loads, in a vec0 table.
  yield* sql`
    CREATE TABLE situations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      note TEXT NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE situation_aliases (
      situation_id TEXT NOT NULL REFERENCES situations (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (situation_id, position)
    )
  `
  yield* sql`
    CREATE TABLE situation_phrases (
      situation_id TEXT NOT NULL REFERENCES situations (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      ja TEXT NOT NULL,
      reading TEXT NOT NULL,
      en TEXT NOT NULL,
      formality TEXT NOT NULL,
      PRIMARY KEY (situation_id, position)
    )
  `
  yield* sql`
    CREATE TABLE situation_entries (
      situation_id TEXT NOT NULL REFERENCES situations (id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      PRIMARY KEY (situation_id, position)
    )
  `
  yield* sql`
    CREATE TABLE situation_embeddings (
      id INTEGER PRIMARY KEY,
      situation_id TEXT NOT NULL REFERENCES situations (id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    )
  `
  yield* sql`CREATE INDEX situation_embeddings_situation ON situation_embeddings (situation_id)`
  yield* sql`
    CREATE VIRTUAL TABLE situation_fts USING fts5 (
      situation_id UNINDEXED,
      text,
      tokenize = 'porter unicode61 remove_diacritics 2'
    )
  `
  yield* sql`
    CREATE TABLE situation_misses (
      id INTEGER PRIMARY KEY,
      query TEXT NOT NULL,
      top_score REAL,
      top_id TEXT,
      created_at INTEGER NOT NULL
    )
  `
})

export const migrations = {
  "0001_dictionary": dictionary,
  "0002_enrichment": enrichment,
  "0003_study": study,
  "0004_situations": situations
}
