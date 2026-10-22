import { PgClient } from "@effect/sql-pg"
import { PgliteClient } from "@effect/sql-pglite"
import { Config, Effect, Layer, Option, type Redacted } from "effect"
import { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { Migrations, naming, pgTypes } from "./Database.ts"

/** Empties the `public` schema so the migrations start from nothing. */
const Reset = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DROP SCHEMA public CASCADE`
    yield* sql`CREATE SCHEMA public`
  })
)

const embedded = PgliteClient.layer(naming)

const server = (url: Redacted.Redacted) =>
  Reset.pipe(Layer.provideMerge(PgClient.layer({ url, types: pgTypes, ...naming })))

/**
 * A fresh, fully migrated database for tests. By default it is PGlite (Postgres
 * compiled to WebAssembly) in memory, so the suite needs nothing installed. Set
 * `KOTORI_TEST_DATABASE_URL` to run the same tests against a real server; that
 * database is wiped on every start, so give the suite one of its own and run
 * `vitest --no-file-parallelism`.
 */
export const DatabaseMemory = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.option(Config.Redacted("KOTORI_TEST_DATABASE_URL"))
    const client: Layer.Layer<SqlClient.SqlClient, SqlError> = Option.match(url, {
      onNone: () => embedded,
      onSome: server
    })
    return Migrations.pipe(Layer.provideMerge(client))
  })
)
