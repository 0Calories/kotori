import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Config, Effect, Layer, String } from "effect"
import { SqlClient } from "effect/sql"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { migrations } from "./migrations.ts"
import { resolveFromRoot } from "./Paths.ts"

const client = (filename: string) =>
  SqliteClient.layer({
    filename,
    transformResultNames: String.snakeToCamel,
    transformQueryNames: String.camelToSnake
  })

const Pragmas = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`PRAGMA foreign_keys = ON`
    yield* sql`PRAGMA synchronous = NORMAL`
  })
)

const Migrations = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })

const withSchema = <E, R>(clientLayer: Layer.Layer<SqliteClient.SqliteClient | SqlClient.SqlClient, E, R>) =>
  Layer.mergeAll(Pragmas, Migrations).pipe(Layer.provideMerge(clientLayer))

/** The application database at `KOTORI_DB_PATH` (default `data/kotori.db`), migrated on startup. */
export const DatabaseLive = withSchema(
  Layer.unwrap(
    Effect.gen(function* () {
      const filename = resolveFromRoot(
        yield* Config.String("KOTORI_DB_PATH").pipe(Config.withDefault("data/kotori.db"))
      )
      mkdirSync(dirname(filename), { recursive: true })
      return client(filename)
    })
  )
)

/** A fresh, fully migrated in-memory database, for tests. */
export const DatabaseMemory = withSchema(client(":memory:"))
