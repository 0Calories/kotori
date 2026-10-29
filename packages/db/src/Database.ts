import { PgClient } from "@effect/sql-pg"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { makePgArray, type PgCodecs, type PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import { RemoteDatabaseError, remoteDatabaseRefusal } from "./DatabaseUrl.ts"
import { relations } from "./schema/relations.ts"

/**
 * Drizzle over Postgres on the Effect `PgClient`, or over PGlite in tests. The two drivers
 * share everything but the raw `execute` result type, so the service is typed by their
 * common base rather than either driver's class.
 */
export type DatabaseShape = PgEffectDatabase<PgDrizzle.EffectPgQueryEffectHKT, PgQueryResultHKT, typeof relations>

/**
 * Drizzle's codecs for the Effect Postgres driver, with `text[]` parameters sent as array
 * literals (`{"a","b"}`) the way the driver already sends most other array types. Left as
 * JS arrays, an empty one fails to encode: `@effect/sql-pg` infers parameter types from
 * the values and can't from `[]` ("Cannot infer the type of an empty array"). A literal is
 * an untyped parameter, so Postgres takes `text[]` from the column. PGlite never had the
 * problem, so tests on it can't catch a regression; `test/database.test.ts` checks the
 * encoding instead.
 */
export const pgCodecs: PgCodecs = {
  ...PgDrizzle.effectPgCodecs,
  text: { ...PgDrizzle.effectPgCodecs.text, normalizeParamArray: (values) => makePgArray(values) }
}

/**
 * The application database as a Drizzle instance. Repositories take this and build
 * typed queries from the tables in `./schema`. Transactions are `db.transaction(tx => …)`;
 * they run on the underlying client's `withTransaction`, so Effect SQL and Drizzle
 * share one connection and one transaction.
 */
export class Database extends Context.Service<Database, DatabaseShape>()("@kotori/db/Database") {
  /** Drizzle over whichever `PgClient` is in scope; see `DatabaseLive` and `DatabaseMemory`. */
  static readonly layer = Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations, codecs: pgCodecs }))
}

/**
 * The Postgres client at `DATABASE_URL` (default `postgres://kotori:kotori@localhost:5432/kotori`).
 * Outside production it fails with `RemoteDatabaseError`, before connecting, unless the
 * database is local or explicitly allowed (`remoteDatabaseRefusal`).
 */
const PgLive = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.Redacted("DATABASE_URL").pipe(
      Config.withDefault(Redacted.make("postgres://kotori:kotori@localhost:5432/kotori"))
    )
    const refusal = remoteDatabaseRefusal(Redacted.value(url), process.env)
    if (refusal !== undefined) return yield* new RemoteDatabaseError({ message: refusal })
    return PgClient.layer({ url })
  })
)

/**
 * The application database: Drizzle and the Effect SQL client over `DATABASE_URL`.
 * Does not migrate. Schema changes are applied by `kotori migrate` before the API and
 * worker start (Fly's release command in production, `pnpm dev:setup` locally).
 */
export const DatabaseLive = Database.layer.pipe(Layer.provideMerge(PgLive))
