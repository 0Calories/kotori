import { and, count, eq, gte, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at } from "./rows.ts"
import { coachCache, coachKind, coachUsage } from "./schema/index.ts"

/** What a coach request asked for, recorded with its usage. */
export type CoachKind = (typeof coachKind.enumValues)[number]

/** Caches coach answers by request and records usage for per-user rate limits. */
export class CoachRepo extends Context.Service<
  CoachRepo,
  {
    /** The cached answer for `key`, if it was stored at or after `notBefore`. Decoding is the caller's. */
    cached(key: string, notBefore: number): Effect.Effect<Option.Option<unknown>>
    store(key: string, result: unknown, now: number): Effect.Effect<void>
    recordUsage(userId: string, kind: CoachKind, now: number): Effect.Effect<void>
    /** Requests of the given kinds since `since`; coaching and audio are limited separately. */
    usageSince(userId: string, since: number, kinds: ReadonlyArray<CoachKind>): Effect.Effect<number>
  }
>()("@kotori/db/CoachRepo") {
  static readonly layer = Layer.effect(
    CoachRepo,
    Effect.gen(function* () {
      const db = yield* Database

      const cached = (key: string, notBefore: number) =>
        db
          .select({ result: coachCache.result })
          .from(coachCache)
          .where(and(eq(coachCache.key, key), gte(coachCache.createdAt, at(notBefore))))
          .pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0]?.result)),
            Effect.orDie
          )

      const store = (key: string, result: unknown, now: number) =>
        db
          .insert(coachCache)
          .values({ key, result, createdAt: at(now) })
          .onConflictDoUpdate({ target: coachCache.key, set: { result, createdAt: at(now) } })
          .pipe(Effect.asVoid, Effect.orDie)

      const recordUsage = (userId: string, kind: CoachKind, now: number) =>
        db
          .insert(coachUsage)
          .values({ userId, kind, createdAt: at(now) })
          .pipe(Effect.asVoid, Effect.orDie)

      const usageSince = (userId: string, since: number, kinds: ReadonlyArray<CoachKind>) =>
        db
          .select({ n: count() })
          .from(coachUsage)
          .where(
            and(
              eq(coachUsage.userId, userId),
              gte(coachUsage.createdAt, at(since)),
              inArray(coachUsage.kind, [...kinds])
            )
          )
          .pipe(
            Effect.map((rows) => rows[0]?.n ?? 0),
            Effect.orDie
          )

      return CoachRepo.of({ cached, store, recordUsage, usageSince })
    })
  )
}
