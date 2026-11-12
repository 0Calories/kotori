import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { migrationsFolder } from "../../src/db/Migrate.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { jobStatusFor } from "../../src/features/enrichment/jobs.ts"
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

/** The old model's tables, as far as the drop needs them, and the job kind it had. */
const OLD_SHAPE = [
  `CREATE TABLE "sense_nuance" ("entry_id" integer, "sense" integer, "nuance" jsonb)`,
  `CREATE TYPE "difference" AS ENUM ('more_casual', 'more_formal')`,
  `CREATE TABLE "similar_words" ("entry_id" integer, "similar_id" integer, "difference" "difference")`,
  `CREATE TABLE "loan_words" ("entry_id" integer, "word" text, "trap" text)`,
  `CREATE TABLE "sense_notes" ("entry_id" integer, "sense" integer, "note" text)`,
  `ALTER TABLE "jobs" ALTER COLUMN "kind" SET DATA TYPE text`,
  `DROP TYPE "job_kind"`,
  `CREATE TYPE "job_kind" AS ENUM ('nuance', 'examples', 'audio')`,
  `ALTER TABLE "jobs" ALTER COLUMN "kind" SET DATA TYPE "job_kind" USING "kind"::"job_kind"`
]

layer(DatabaseMemory)("the migration dropping the nuance model", (it) => {
  it.effect("drops the old tables and the nuance jobs, and keeps the other jobs as they were", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const run = (statements: ReadonlyArray<string>) =>
        Effect.forEach(statements, (statement) => db.execute(sql.raw(statement)), { discard: true })
      yield* insertEntries(db, entries)
      const taberu = EntryId.make(1358280)
      yield* run(OLD_SHAPE)
      yield* db.execute(sql`
        INSERT INTO "jobs" ("kind", "entry_id", "status")
        VALUES ('nuance', ${taberu}, 'queued'), ('examples', ${taberu}, 'done'), ('audio', ${taberu}, 'failed')`)
      yield* db.execute(sql`INSERT INTO "sense_nuance" VALUES (${taberu}, 0, '{}')`)

      yield* run(statementsOf("drop_nuance_model"))

      assert.deepStrictEqual(
        [...(yield* jobStatusFor(db, taberu))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "failed"],
          ["examples", "done"]
        ]
      )
      const rows = <A>(statement: ReturnType<typeof sql>) =>
        Effect.map(db.execute(statement), (result) => (result as { readonly rows: ReadonlyArray<A> }).rows)
      const left = yield* rows<{ name: string | null }>(sql`
        SELECT to_regclass(name)::text AS name
        FROM unnest(ARRAY['sense_nuance', 'similar_words', 'loan_words', 'sense_notes']) AS name`)
      assert.deepStrictEqual(
        left.map((row) => row.name),
        [null, null, null, null]
      )
      const kinds = yield* rows<{ kind: string }>(sql`SELECT unnest(enum_range(NULL::job_kind))::text AS kind`)
      assert.deepStrictEqual(
        kinds.map((row) => row.kind),
        ["examples", "audio"]
      )
    })
  )
})
