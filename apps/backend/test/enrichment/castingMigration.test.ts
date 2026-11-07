import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { migrationsFolder } from "../../src/db/Migrate.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { examplesFor } from "../../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries } from "../fixtures.ts"

/** A migration's statements as it ships. */
const statementsOf = (name: string) => {
  const folder = readdirSync(migrationsFolder).find((own) => own.endsWith(name))!
  return readFileSync(join(migrationsFolder, folder, "migration.sql"), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

/** The five casting columns and their enums, as they were before `casting`. */
const OLD_SHAPE = [
  `CREATE TYPE "speaker_gender" AS ENUM ('masculine', 'feminine', 'unspecified')`,
  `CREATE TYPE "speaker_age" AS ENUM ('child', 'youth', 'adult', 'middle-aged', 'older', 'unspecified')`,
  `CREATE TYPE "sentence_medium" AS ENUM ('conversation', 'announcement', 'narration')`,
  `CREATE TYPE "sentence_tone" AS ENUM ('neutral', 'cheerful', 'serious', 'gentle', 'rough', 'humorous')`,
  `ALTER TABLE "examples" ADD COLUMN "speaker_gender" "speaker_gender", ADD COLUMN "speaker_age" "speaker_age",
     ADD COLUMN "medium" "sentence_medium", ADD COLUMN "variety" text, ADD COLUMN "tone" "sentence_tone"`
]

layer(DatabaseMemory)("the example casting migration", (it) => {
  it.effect("folds the casting columns into one JSONB, carrying every value over", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const run = (statements: ReadonlyArray<string>) =>
        Effect.forEach(statements, (statement) => db.execute(sql.raw(statement)), { discard: true })
      yield* insertEntries(db, entries)
      const taberu = EntryId.make(1358280)
      yield* run(OLD_SHAPE)
      const old = (
        position: number,
        source: string,
        formality: string | null,
        signals: [string | null, string | null, string | null, string | null, string | null]
      ) =>
        db.execute(sql`
          INSERT INTO "examples" ("entry_id", "sense", "position", "ja", "furigana", "en", "formality", "source",
            "speaker_gender", "speaker_age", "medium", "variety", "tone")
          VALUES (${taberu}, 0, ${position}, ${`文${position}`}, ${`文${position}`}, ${`Sentence ${position}`},
            ${formality}::formality, ${source}::source, ${signals[0]}::speaker_gender, ${signals[1]}::speaker_age,
            ${signals[2]}::sentence_medium, ${signals[3]}, ${signals[4]}::sentence_tone)`)
      // Claude's, judged in full; Claude's, written before casting; seeded; and one with a gap.
      yield* old(0, "kotori", "casual", ["feminine", "youth", "conversation", "kansai", "cheerful"])
      yield* old(1, "kotori", "polite", [null, null, null, null, null])
      yield* old(2, "tatoeba", null, [null, null, null, null, null])
      yield* old(3, "kotori", "formal", [null, "older", "narration", null, "serious"])

      // As it ships, twice: carried-over rows are left alone. Then the columns go.
      yield* run(statementsOf("example_casting"))
      yield* run(statementsOf("example_casting"))
      yield* run(statementsOf("drop_example_casting_columns"))

      const rows = yield* examplesFor(db, [taberu])
      assert.deepStrictEqual(
        rows.map((row) => [row.ja, row.formality, row.casting]),
        [
          [
            "文0",
            "casual",
            {
              speakerGender: "feminine",
              speakerAge: "youth",
              medium: "conversation",
              variety: "kansai",
              tone: "cheerful"
            }
          ],
          ["文1", "polite", null],
          [
            "文3",
            "formal",
            { speakerGender: "unspecified", speakerAge: "older", medium: "narration", variety: null, tone: "serious" }
          ],
          // Seeded, after Kotori's: no formality and no casting until Jev judges it.
          ["文2", null, null]
        ]
      )
    })
  )
})
