import { PgClient, PgMigrator, PgTypes } from "@effect/sql-pg"
import { Config, Effect, Layer, Redacted, Result, String } from "effect"
import { migrations } from "./migrations.ts"

/**
 * Decodes `bigint` columns and aggregates (`count`, `sum`) to `number`.
 * Every bigint in the schema is a millisecond timestamp or a count, far below
 * `Number.MAX_SAFE_INTEGER`; a value outside that range is a bug, not data.
 */
const int8AsNumber: PgTypes.Codec<number> = {
  decode: (bytes) => {
    const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0)
    const number = Number(value)
    return Number.isSafeInteger(number)
      ? Result.succeed(number)
      : Result.fail(new PgTypes.CodecError({ message: `int8 value ${value} is not a safe integer` }))
  },
  encode: (value) => {
    if (!Number.isSafeInteger(value)) {
      return Result.fail(new PgTypes.CodecError({ message: `Expected a safe integer for int8, got ${value}` }))
    }
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, BigInt(value))
    return Result.succeed(bytes)
  }
}

const types = PgTypes.makeRegistry()
types.register(PgTypes.OID.int8, int8AsNumber, { arrayOid: PgTypes.OID.int8Array })

const Migrations = PgMigrator.layer({ loader: PgMigrator.fromRecord(migrations) })

/** The application database at `DATABASE_URL` (default `postgres://localhost:5432/kotori`), migrated on startup. */
export const DatabaseLive = Migrations.pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.gen(function* () {
        const url = yield* Config.Redacted("DATABASE_URL").pipe(
          Config.withDefault(Redacted.make("postgres://localhost:5432/kotori"))
        )
        return PgClient.layer({
          url,
          types,
          transformResultNames: String.snakeToCamel,
          transformQueryNames: String.camelToSnake
        })
      })
    )
  )
)
