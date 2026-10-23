import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

const CacheRow = Schema.Struct({ result: Schema.String })
const CountRow = Schema.Struct({ n: Schema.Int })

/** Caches coach answers by request and records usage for per-user rate limits. */
export class CoachRepo extends Context.Service<
  CoachRepo,
  {
    cached(key: string, notBefore: number): Effect.Effect<Option.Option<string>>
    store(key: string, result: string, now: number): Effect.Effect<void>
    recordUsage(userId: string, kind: string, now: number): Effect.Effect<void>
    usageSince(userId: string, since: number): Effect.Effect<number>
  }
>()("@kotori/db/CoachRepo") {
  static readonly layer = Layer.effect(
    CoachRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const cached = (key: string, notBefore: number) =>
        sql`SELECT result FROM coach_cache WHERE key = ${key} AND created_at >= ${notBefore}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CacheRow))),
          Effect.map((rows) => Option.fromNullishOr(rows[0]?.result)),
          Effect.orDie
        )

      const store = (key: string, result: string, now: number) =>
        sql`
          INSERT INTO coach_cache (key, result, created_at) VALUES (${key}, ${result}, ${now})
          ON CONFLICT (key) DO UPDATE SET result = excluded.result, created_at = excluded.created_at
        `.pipe(Effect.asVoid, Effect.orDie)

      const recordUsage = (userId: string, kind: string, now: number) =>
        sql`INSERT INTO coach_usage (user_id, kind, created_at) VALUES (${userId}, ${kind}, ${now})`.pipe(
          Effect.asVoid,
          Effect.orDie
        )

      const usageSince = (userId: string, since: number) =>
        sql`SELECT count(*) AS n FROM coach_usage WHERE user_id = ${userId} AND created_at >= ${since}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CountRow))),
          Effect.map((rows) => rows[0]?.n ?? 0),
          Effect.orDie
        )

      return CoachRepo.of({ cached, store, recordUsage, usageSince })
    })
  )
}
