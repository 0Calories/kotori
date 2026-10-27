import { PgClient } from "@effect/sql-pg"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import type { PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import { relations } from "./schema/relations.ts"

/**
 * Drizzle over Postgres on the Effect `PgClient`, or over PGlite in tests. The two drivers
 * share everything but the raw `execute` result type, so the service is typed by their
 * common base rather than either driver's class.
 */
export type DatabaseShape = PgEffectDatabase<PgDrizzle.EffectPgQueryEffectHKT, PgQueryResultHKT, typeof relations>

/**
 * The application database as a Drizzle instance. Repositories take this and build
 * typed queries from the tables in `./schema`. Transactions are `db.transaction(tx => …)`;
 * they run on the underlying client's `withTransaction`, so Effect SQL and Drizzle
 * share one connection and one transaction.
 */
export class Database extends Context.Service<Database, DatabaseShape>()("@kotori/db/Database") {
  /** Drizzle over whichever `PgClient` is in scope; see `DatabaseLive` and `DatabaseMemory`. */
  static readonly layer = Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations }))
}

/** The Postgres client at `DATABASE_URL` (default `postgres://kotori:kotori@localhost:5432/kotori`). */
const PgLive = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.Redacted("DATABASE_URL").pipe(
      Config.withDefault(Redacted.make("postgres://kotori:kotori@localhost:5432/kotori"))
    )
    return PgClient.layer({ url })
  })
)

/**
 * The application database: Drizzle and the Effect SQL client over `DATABASE_URL`.
 * Does not migrate. Schema changes are applied by `kotori migrate` before the API and
 * worker start (Fly's release command in production, `pnpm dev:setup` locally).
 */
export const DatabaseLive = Database.layer.pipe(Layer.provideMerge(PgLive))
