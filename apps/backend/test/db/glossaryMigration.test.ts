import { PgliteClient } from "@effect/sql-pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { readdirSync, readFileSync } from "node:fs"
import { migrationsFolder } from "../../src/db/Migrate.ts"

const GLOSSARY = "20261109211253_glossary_language"

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
const N1 = "00000000-0000-4000-8000-00000000000a"
const N2 = "00000000-0000-4000-8000-00000000000b"
const N3 = "00000000-0000-4000-8000-00000000000c"
const C1 = "00000000-0000-4000-8000-0000000000c1"
const C2 = "00000000-0000-4000-8000-0000000000c2"
const C3 = "00000000-0000-4000-8000-0000000000c3"

// The glossary migration on a database as it stood before it, with rows in the old shape: an
// empty PGlite taken through every earlier migration by hand, so the old tables can be filled.
layer(PgliteClient.layer({ dataDir: "memory://", extensions: { pg_trgm } }))("the glossary migration", (it) => {
  it.effect("moves each card's schedule and review logs onto its note, and renames tag labels to names", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const folders = readdirSync(migrationsFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
      // Only the migrations before it: later ones are written against the glossary's names.
      assert.include(folders, GLOSSARY)
      for (const folder of folders.filter((own) => own < GLOSSARY)) yield* run(folder)

      yield* sql.unsafe(`
        INSERT INTO users (id, status, role) VALUES ('${U1}', 'approved', 'user'), ('${U2}', 'approved', 'admin')`)
      const phrase = JSON.stringify({
        kind: "phrase",
        text: "お疲れ様です",
        furigana: null,
        meaning: "good work",
        note: null,
        register: "polite",
        source: "how-to-say"
      })
      const word = JSON.stringify({
        kind: "word",
        entryId: 1,
        senseIndex: 0,
        headword: "食べる",
        reading: "たべる",
        meaning: "to eat",
        hint: null,
        example: null,
        audioUrl: null
      })
      yield* sql.unsafe(`
        INSERT INTO notes (id, user_id, kind, content, created_at) VALUES
          ('${N1}', '${U1}', 'phrase', '${phrase}', '2026-11-01T00:00:00Z'),
          ('${N2}', '${U1}', 'word', '${word}', '2026-11-02T00:00:00Z'),
          ('${N3}', '${U1}', 'word', '${word}', '2026-11-03T00:00:00Z')`)
      // N1 is in review; N2 kept a stray reverse card beside its own; N3 never had a card.
      yield* sql.unsafe(`
        INSERT INTO cards
          (id, note_id, user_id, template, queue, due, "interval", ease, step, reps, lapses, leech, last_review, seed, position)
        VALUES
          ('${C1}', '${N1}', '${U1}', 'recognize', 'review', '2026-11-20T19:00:00Z', 12, 2.3, 0, 5, 1, true, '2026-11-08T03:00:00Z', 41, 0),
          ('${C2}', '${N2}', '${U1}', 'recognize', 'learning', '2026-11-09T03:10:00Z', 0, 0, 1, 2, 0, false, '2026-11-09T03:00:00Z', 42, 1),
          ('${C3}', '${N2}', '${U1}', 'produce', 'new', '2026-11-02T00:00:00Z', 0, 0, 0, 0, 0, false, NULL, 43, 2)`)
      yield* sql.unsafe(`
        INSERT INTO review_logs
          (card_id, user_id, rating, queue_before, interval_before, "interval", ease_before, ease, delay_ms, reviewed_at, study_day)
        VALUES
          ('${C1}', '${U1}', 'good', 'review', 5, 12, 2.3, 2.3, 0, '2026-11-08T03:00:00Z', 20400),
          ('${C1}', '${U1}', 'again', 'review', 8, 5, 2.5, 2.3, 0, '2026-11-03T03:00:00Z', 20395),
          ('${C2}', '${U1}', 'good', 'new', 0, 0, 0, 0, 0, '2026-11-09T03:00:00Z', 20401),
          ('${C3}', '${U1}', 'again', 'new', 0, 0, 0, 0, 0, '2026-11-04T03:00:00Z', 20396)`)
      yield* sql.unsafe(`INSERT INTO tags (code, label) VALUES ('v1', 'Ichidan verb')`)

      yield* run(GLOSSARY)

      const notes = yield* sql.unsafe<Record<string, unknown>>(`
        SELECT id, user_id, retention_stage, due, "interval", ease, step, reps, lapses, leech, last_review, seed,
          position, content->>'register' AS register
        FROM notes ORDER BY created_at`)
      assert.deepStrictEqual(notes[0], {
        id: N1,
        user_id: U1,
        retention_stage: "review",
        due: new Date("2026-11-20T19:00:00Z"),
        interval: 12,
        ease: 2.3,
        step: 0,
        reps: 5,
        lapses: 1,
        leech: true,
        last_review: new Date("2026-11-08T03:00:00Z"),
        seed: 41,
        position: 0,
        register: "polite"
      })
      // The note's own card wins over the stray reverse one.
      assert.deepInclude(notes[1], { id: N2, retention_stage: "learning", step: 1, reps: 2, seed: 42, position: 1 })
      assert.deepStrictEqual(notes[1]?.["due"], new Date("2026-11-09T03:10:00Z"))
      // A note without a card starts new, due when it was saved, after the user's others.
      assert.deepInclude(notes[2], { id: N3, retention_stage: "new", reps: 0, leech: false, position: 2 })
      assert.deepStrictEqual(notes[2]?.["due"], new Date("2026-11-03T00:00:00Z"))
      assert.isNumber(notes[2]?.["seed"])

      // Reviews of the discarded stray reverse card (C3) are dropped rather than mixed into N2.
      const logs = yield* sql.unsafe<Record<string, unknown>>(`
        SELECT note_id, user_id, rating, retention_stage_before, study_day FROM review_logs ORDER BY study_day`)
      assert.deepStrictEqual(logs, [
        { note_id: N1, user_id: U1, rating: "again", retention_stage_before: "review", study_day: 20395 },
        { note_id: N1, user_id: U1, rating: "good", retention_stage_before: "review", study_day: 20400 },
        { note_id: N2, user_id: U1, rating: "good", retention_stage_before: "new", study_day: 20401 }
      ])

      const users = yield* sql.unsafe<Record<string, unknown>>(`SELECT id, role::text AS role FROM users ORDER BY id`)
      assert.deepStrictEqual(users, [
        { id: U1, role: "user" },
        { id: U2, role: "admin" }
      ])

      assert.deepStrictEqual(yield* sql.unsafe(`SELECT name FROM tags`), [{ name: "Ichidan verb" }])

      const gone = yield* sql.unsafe<Record<string, unknown>>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'cards'`)
      assert.deepStrictEqual(gone, [])

      // Deleting a user still takes their notes and review logs with them.
      yield* sql.unsafe(`DELETE FROM users WHERE id = '${U1}'`)
      const left = yield* sql.unsafe<Record<string, unknown>>(`
        SELECT (SELECT count(*)::int FROM notes) AS notes, (SELECT count(*)::int FROM review_logs) AS logs`)
      assert.deepStrictEqual(left, [{ notes: 0, logs: 0 }])
    })
  )
})
