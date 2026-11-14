import { PgliteClient } from "@effect/sql-pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { readdirSync, readFileSync } from "node:fs"
import { migrationsFolder } from "../../src/db/Migrate.ts"

const NOTES_ARE_ENTRIES = "20261114185840_notes_are_entries"

/** A migration file's statements, split the way the migrator runs them. */
const statements = (folder: string) =>
  readFileSync(`${migrationsFolder}/${folder}/migration.sql`, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

const run = Effect.fnUntraced(function* (folder: string) {
  const sql = yield* SqlClient.SqlClient
  for (const statement of statements(folder)) yield* sql.unsafe(statement)
})

const U1 = "00000000-0000-4000-8000-000000000001"
const U2 = "00000000-0000-4000-8000-000000000002"
const EAT = "00000000-0000-4000-8000-0000000000a1"
const EAT_LATER = "00000000-0000-4000-8000-0000000000a2"
const PHRASE = "00000000-0000-4000-8000-0000000000a3"
const ORPHAN = "00000000-0000-4000-8000-0000000000a4"
const OTHER = "00000000-0000-4000-8000-0000000000a5"

// The migration on a database as it stood before it, with rows in the old shape: an empty PGlite
// taken through every earlier migration by hand, so the old columns can be filled.
layer(PgliteClient.layer({ dataDir: "memory://", extensions: { pg_trgm } }))(
  "the notes-are-entries migration",
  (it) => {
    it.effect("merges each learner's sense notes into one per entry, drops phrases, and settles old proposals", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const folders = readdirSync(migrationsFolder, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
        assert.include(folders, NOTES_ARE_ENTRIES)
        for (const folder of folders.filter((own) => own < NOTES_ARE_ENTRIES)) yield* run(folder)

        yield* sql.unsafe(`
        INSERT INTO users (id, status, role) VALUES ('${U1}', 'approved', 'user'), ('${U2}', 'approved', 'user')`)
        yield* sql.unsafe(`
        INSERT INTO entries (id, language, source, headword, reading) VALUES
          (1358280, 'ja', 'jmdict', '食べる', 'たべる'),
          (200000001, 'ja', 'kotori', '蛙化現象', 'かえるかげんしょう')`)
        const word = (sense: number) => `'{"kind":"word","entryId":1358280,"senseIndex":${sense}}'`
        // U1 saved two senses of 食べる (the later one further along), a phrase, and a word whose
        // entry has since gone; U2 saved one sense of 食べる.
        yield* sql.unsafe(`
        INSERT INTO notes (id, user_id, kind, content, entry_id, sense, due, reps, seed, position, created_at) VALUES
          ('${EAT}', '${U1}', 'word', ${word(2)}, 1358280, 2, '2026-11-01T00:00:00Z', 1, 1, 0, '2026-11-01T00:00:00Z'),
          ('${EAT_LATER}', '${U1}', 'word', ${word(0)}, 1358280, 0, '2026-11-02T00:00:00Z', 4, 2, 1, '2026-11-02T00:00:00Z'),
          ('${PHRASE}', '${U1}', 'phrase', '{"kind":"phrase"}', NULL, NULL, '2026-11-03T00:00:00Z', 0, 3, 2, '2026-11-03T00:00:00Z'),
          ('${ORPHAN}', '${U1}', 'word', ${word(0)}, NULL, NULL, '2026-11-04T00:00:00Z', 0, 4, 3, '2026-11-04T00:00:00Z'),
          ('${OTHER}', '${U2}', 'word', ${word(1)}, 1358280, 1, '2026-11-05T00:00:00Z', 0, 5, 0, '2026-11-05T00:00:00Z')`)
        const log = (note: string, day: number) =>
          `('${note}', '${U1}', 'good', 'new', 0, 0, 0, 0, 0, '2026-11-08T03:00:00Z', ${day})`
        yield* sql.unsafe(`
        INSERT INTO review_logs
          (note_id, user_id, rating, retention_stage_before, interval_before, "interval", ease_before, ease, delay_ms, reviewed_at, study_day)
        VALUES ${log(EAT, 20400)}, ${log(EAT_LATER, 20401)}, ${log(PHRASE, 20402)}`)
        const proposal = (query: string, status: string, linked: string, reason: string) =>
          `('ja', '${query}', '${status}', ${status === "pending" ? `'{"headword":"${query}"}'` : "NULL"}, ${linked}, ${reason}, 'test')`
        yield* sql.unsafe(`
        INSERT INTO proposals (language, query, status, draft, linked_entry_id, reason, model) VALUES
          ${proposal("ぴえん", "pending", "NULL", "NULL")},
          ${proposal("蛙化現象", "approved", "200000001", "NULL")},
          ${proposal("消えた", "approved", "NULL", "NULL")},
          ${proposal("ぬるぬる語", "discarded", "NULL", "'not established usage'")},
          ${proposal("たべる", "linked", "1358280", "NULL")},
          ${proposal("あsdf", "rejected", "NULL", "'実在しません。'")}`)

        yield* run(NOTES_ARE_ENTRIES)

        // One note per learner and entry: the one furthest along, showing the senses saved, in the
        // dictionary's order, with every review of the notes merged into it.
        const notes = yield* sql.unsafe<Record<string, unknown>>(`
        SELECT id, user_id, entry_id, senses, reps FROM notes ORDER BY user_id`)
        assert.deepStrictEqual(notes, [
          { id: EAT_LATER, user_id: U1, entry_id: 1358280, senses: [0, 2], reps: 4 },
          { id: OTHER, user_id: U2, entry_id: 1358280, senses: [1], reps: 0 }
        ])
        const logs = yield* sql.unsafe<Record<string, unknown>>(
          `SELECT note_id, study_day FROM review_logs ORDER BY study_day`
        )
        assert.deepStrictEqual(logs, [
          { note_id: EAT_LATER, study_day: 20400 },
          { note_id: EAT_LATER, study_day: 20401 }
        ])

        // Pending drafts were never entries and go; an approval names its entry as a draft does;
        // a discard stays turned down, without the admin's words.
        const proposals = yield* sql.unsafe<Record<string, unknown>>(`
        SELECT query, status::text AS status, entry_id, reason FROM proposals ORDER BY id`)
        assert.deepStrictEqual(proposals, [
          { query: "蛙化現象", status: "drafted", entry_id: 200000001, reason: null },
          { query: "ぬるぬる語", status: "rejected", entry_id: null, reason: null },
          { query: "たべる", status: "linked", entry_id: 1358280, reason: null },
          { query: "あsdf", status: "rejected", entry_id: null, reason: "実在しません。" }
        ])

        // Every entry so far stands approved.
        const reviews = yield* sql.unsafe<Record<string, unknown>>(
          `SELECT DISTINCT review::text AS review FROM entries`
        )
        assert.deepStrictEqual(reviews, [{ review: "approved" }])

        // A learner saves an entry once; deleting the entry takes their note with it.
        const twice = yield* sql
          .unsafe(`
          INSERT INTO notes (user_id, entry_id, due, seed, position)
          VALUES ('${U1}', 1358280, '2026-11-06T00:00:00Z', 6, 4)`)
          .pipe(Effect.flip)
        // The only unique key the row could break is the learner's and entry's.
        assert.include(String((twice as { readonly cause?: unknown }).cause), "UniqueViolation")
        yield* sql.unsafe(`DELETE FROM entries WHERE id = 1358280`)
        assert.deepStrictEqual(yield* sql.unsafe(`SELECT count(*)::int AS n FROM notes`), [{ n: 0 }])
      })
    )
  }
)
