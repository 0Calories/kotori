import { PgClient } from "@effect/sql-pg"
import { PgliteClient } from "@effect/sql-pglite"
import { assert, describe, it, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { senses } from "@kotori/db"
import { sql } from "drizzle-orm"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { readdirSync } from "node:fs"
import { Database, pgCodecs } from "../../src/db/Database.ts"
import { migrateDatabase, migrationsFolder } from "../../src/db/Migrate.ts"
import { relations } from "../../src/db/relations.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

layer(DatabaseMemory)("Database", (it) => {
  it.effect("answers queries through Drizzle on the shared client", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const result = (yield* db.execute(sql`SELECT 1 + 1 AS two`)) as { readonly rows: ReadonlyArray<unknown> }
      assert.deepStrictEqual(result.rows, [{ two: 2 }])
    })
  )

  it.effect("has applied the migrations folder once and applying again is a no-op", () =>
    Effect.gen(function* () {
      yield* migrateDatabase()
      const sqlClient = yield* SqlClient.SqlClient
      const applied = yield* sqlClient<{ readonly name: string }>`
        SELECT name FROM drizzle.__drizzle_migrations ORDER BY id
      `
      const folders = readdirSync(migrationsFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
      assert.deepStrictEqual(
        applied.map((row) => row.name),
        folders
      )
    })
  )
})

const Unmigrated = Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations })).pipe(
  Layer.provideMerge(PgliteClient.layer({ dataDir: "memory://" }))
)

layer(Unmigrated)("Database on the legacy schema", (it) => {
  it.effect("refuses to migrate and changes nothing", () =>
    Effect.gen(function* () {
      const sqlClient = yield* SqlClient.SqlClient
      yield* sqlClient`CREATE TABLE effect_sql_migrations (migration_id integer PRIMARY KEY, name text NOT NULL)`
      yield* sqlClient`CREATE TABLE entries (id integer PRIMARY KEY, headword text NOT NULL)`

      const error = yield* migrateDatabase().pipe(Effect.flip)
      assert.strictEqual(error._tag, "LegacySchemaError")
      assert.include(error.message, "effect_sql_migrations")

      const drizzle = yield* sqlClient<{ readonly n: number }>`
        SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name = 'drizzle'
      `
      assert.strictEqual(drizzle[0]?.n, 0)
    })
  )
})

// `@effect/sql-pg` cannot bind empty JS arrays (unlike PGlite), and `.toSQL()` exercises `pgCodecs` without connecting.
describe("Database on Postgres", () => {
  it.effect("sends text arrays as array literals, empty ones included", () =>
    Effect.gen(function* () {
      const db = yield* PgDrizzle.makeWithDefaults({ relations, codecs: pgCodecs }).pipe(
        Effect.provideService(PgClient.PgClient, {} as PgClient.PgClient)
      )
      const { params } = db
        .insert(senses)
        .values({ entryId: EntryId.make(1), position: 0, pos: ["v1", 'say "hi"\\'], misc: [] })
        .toSQL()
      assert.include(params, '{"v1","say \\"hi\\"\\\\"}')
      assert.include(params, "{}")
      assert.isFalse(params.some(Array.isArray))
    })
  )
})
