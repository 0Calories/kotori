import { PgClient, PgTypes } from "@effect/sql-pg"
import { Config, Effect, Layer, Result, String } from "effect"
import * as Migrator from "effect/sql/Migrator"
import { migrations } from "./migrations.ts"

/** Column naming shared by every client: snake_case in SQL, camelCase in TypeScript. JSON values are left as written. */
export const naming = {
  transformResultNames: String.snakeToCamel,
  transformQueryNames: String.camelToSnake,
  transformJson: false
}

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * `bigint` columns hold millisecond timestamps and counts, which fit a JavaScript
 * number with room to spare. Decoding them as numbers keeps BigInt out of the
 * repositories and matches what PGlite returns in tests.
 */
const int8AsNumber: PgTypes.Codec<number | bigint> = {
  decode: (bytes) => {
    const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0)
    return value >= MIN_SAFE && value <= MAX_SAFE
      ? Result.succeed(Number(value))
      : Result.fail(new PgTypes.CodecError({ message: `bigint ${value} does not fit a JavaScript number` }))
  },
  encode: (value) => {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, BigInt(value))
    return Result.succeed(bytes)
  }
}

/** The Postgres codec registry: built-ins, with `bigint` read as a number. */
export const pgTypes = PgTypes.makeRegistry()
pgTypes.register(PgTypes.OID.int8, int8AsNumber)

/** Runs pending migrations at startup. The migrator takes a lock, so the API and the worker can start together. */
export const Migrations = Layer.effectDiscard(Migrator.make({})({ loader: Migrator.fromRecord(migrations) }))

/** The application database at `DATABASE_URL` (Railway's Postgres provides it), migrated on startup. */
export const DatabaseLive = Migrations.pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.gen(function* () {
        const url = yield* Config.Redacted("DATABASE_URL")
        return PgClient.layer({ url, types: pgTypes, ...naming })
      })
    )
  )
)
