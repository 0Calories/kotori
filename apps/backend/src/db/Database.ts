import { PgClient } from "@effect/sql-pg"
import type { SQL } from "drizzle-orm"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { makePgArray, type PgCodecs, type PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { PgEffectDatabase } from "drizzle-orm/pg-core/effect"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import { relations } from "./relations.ts"

// PgClient and PgliteClient differ in raw execute result types, so type Database by their shared PgEffectDatabase base.
export type DatabaseShape = PgEffectDatabase<PgDrizzle.EffectPgQueryEffectHKT, PgQueryResultHKT, typeof relations>

// Encode text[] parameters as Postgres array literals because @effect/sql-pg cannot infer a parameter type from an empty JS array ([]).
export const pgCodecs: PgCodecs = {
  ...PgDrizzle.effectPgCodecs,
  text: { ...PgDrizzle.effectPgCodecs.text, normalizeParamArray: (values) => makePgArray(values) }
}

export class Database extends Context.Service<Database, DatabaseShape>()("@kotori/backend/Database") {
  static readonly layer = Layer.effect(Database, PgDrizzle.makeWithDefaults({ relations, codecs: pgCodecs }))
}

export const rawRows = <A>(db: DatabaseShape, statement: SQL) =>
  db.execute(statement).pipe(Effect.map((result) => (result as { readonly rows: ReadonlyArray<A> }).rows))

const PgLive = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.Redacted("DATABASE_URL").pipe(
      Config.withDefault(Redacted.make("postgres://kotori:kotori@localhost:5432/kotori"))
    )
    return PgClient.layer({ url })
  })
)

export const DatabaseLive = Database.layer.pipe(Layer.provideMerge(PgLive))
