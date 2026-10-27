import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { Database } from "../src/Database.ts"
import { migrateDatabase } from "../src/Migrate.ts"
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
      assert.deepStrictEqual(
        applied.map((row) => row.name),
        ["20261027175222_initial"]
      )
    })
  )
})
