import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Database, rawRows } from "../../src/db/Database.ts"
import { migrationsFolder } from "../../src/db/Migrate.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

/** A migration's statements as it ships. */
const statementsOf = (name: string) => {
  const folder = readdirSync(migrationsFolder).find((own) => own.endsWith(name))!
  return readFileSync(join(migrationsFolder, folder, "migration.sql"), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

layer(DatabaseMemory)("the migration splitting a loan's meaning source from its pair's", (it) => {
  it.effect("credits every meaning set so far to Kotori, including one a reseed relabelled as JMDict's", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const run = (statements: ReadonlyArray<string>) =>
        Effect.forEach(statements, (statement) => db.execute(sql.raw(statement)), { discard: true })
      yield* run([
        `ALTER TABLE "loan_links" DROP CONSTRAINT "loan_links_meaning_source"`,
        `ALTER TABLE "loan_links" DROP COLUMN "meaning_source"`
      ])
      yield* db.execute(sql`
        INSERT INTO "loan_links" ("katakana", "english", "meaning", "source")
        VALUES ('マンション', 'mansion', 'wasei_eigo', 'jmdict'),
               ('アドバイス', 'advice', 'true_loanword', 'kotori'),
               ('テレビ', 'television', NULL, 'jmdict')`)

      yield* run(statementsOf("loan_meaning_source"))

      const rows = yield* rawRows(
        db,
        sql`SELECT "katakana", "source", "meaning_source" FROM "loan_links" ORDER BY "id"`
      )
      assert.deepStrictEqual(rows, [
        { katakana: "マンション", source: "jmdict", meaning_source: "kotori" },
        { katakana: "アドバイス", source: "kotori", meaning_source: "kotori" },
        { katakana: "テレビ", source: "jmdict", meaning_source: null }
      ])
      // A meaning without its source, or a source without a meaning, is refused.
      const refused = yield* db
        .execute(sql`UPDATE "loan_links" SET "meaning_source" = NULL WHERE "katakana" = 'マンション'`)
        .pipe(Effect.flip)
      assert.include(JSON.stringify(refused), "loan_links_meaning_source")
    })
  )
})
