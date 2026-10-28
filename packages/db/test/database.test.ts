import { readdirSync } from "node:fs"
import { PgClient } from "@effect/sql-pg"
import { PgliteClient } from "@effect/sql-pglite"
import { assert, describe, it, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { Database, pgCodecs } from "../src/Database.ts"
import { migrateDatabase, migrationsFolder } from "../src/Migrate.ts"
import { senses } from "../src/schema/index.ts"
import { relations } from "../src/schema/relations.ts"
import { DatabaseMemory } from "../src/testing.ts"

// The Drizzle instance and the migrator over PGlite: the same code paths production
// uses, minus the network.
layer(DatabaseMemory)("Database", (it) => {
  it.effect("answers queries through Drizzle on the shared client", () =>
    Effect.gen(function* () {
      const db = yield* Database
      // `execute` is untyped on the drivers' common base; typed access goes through tables.
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

// An empty PGlite that nothing has migrated yet, to stand in for a database from before the rebuild.
const Unmigrated = Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations })).pipe(
  Layer.provideMerge(PgliteClient.layer({ dataDir: "memory://" }))
)

layer(Unmigrated)("Database on the legacy schema", (it) => {
  it.effect("refuses to migrate and changes nothing", () =>
    Effect.gen(function* () {
      const sqlClient = yield* SqlClient.SqlClient
      // What the Effect SQL migrator and the first hand-written migration left behind.
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

// The Postgres driver's encoding, which PGlite doesn't share: `@effect/sql-pg` can't bind an
// empty JS array, and the seeder writes plenty (forms without tags, senses without misc codes).
// The client is never reached; `toSQL` only renders the statement and its parameters.
describe("Database on Postgres", () => {
  it.effect("sends text arrays as array literals, empty ones included", () =>
    Effect.gen(function* () {
      const db = yield* PgDrizzle.makeWithDefaults({ relations, codecs: pgCodecs }).pipe(
        Effect.provideService(PgClient.PgClient, {} as PgClient.PgClient)
      )
      const { params } = db
        .insert(senses)
        .values({ entryId: 1, position: 0, pos: ["v1", 'say "hi"\\'], misc: [] })
        .toSQL()
      assert.include(params, '{"v1","say \\"hi\\"\\\\"}')
      assert.include(params, "{}")
      assert.isFalse(params.some(Array.isArray))
    })
  )
})
