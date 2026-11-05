import { coachCache, coachUsage, users } from "@kotori/db"
import { and, count, eq, gte, inArray } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import type { Learner } from "../../db/scopedToUser.ts"

/** What a coach request asked for, recorded with its usage. */
export type CoachKind = typeof coachUsage.$inferSelect.kind

/** The cached answer for `key`, if it was stored at or after `notBefore`. Decoding is the caller's. */
export const cachedAnswer = (db: DatabaseShape, key: string, notBefore: Date) =>
  db
    .select({ result: coachCache.result })
    .from(coachCache)
    .where(and(eq(coachCache.key, key), gte(coachCache.createdAt, notBefore)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0]?.result)),
      Effect.orDie
    )

export const storeAnswer = (db: DatabaseShape, key: string, result: unknown, now: Date) =>
  db
    .insert(coachCache)
    .values({ key, result, createdAt: now })
    .onConflictDoUpdate({ target: coachCache.key, set: { result, createdAt: now } })
    .pipe(Effect.asVoid, Effect.orDie)

/** At most `limit` requests since `since`: one window of a rate limit. */
export interface UsageWindow {
  readonly since: Date
  readonly limit: number
}

/**
 * Records a request of `kind` if, in every window, the learner has made fewer than its `limit`
 * requests of `kinds`; otherwise returns the first window that is full, recording nothing. One
 * row however many windows, so an hourly and a daily limit count each request once. The
 * learner's profile row is locked for the transaction, so two requests at once can't both take
 * the last slot.
 */
export const reserveUsage = Effect.fn("coaching.reserveUsage")(function* (
  learner: Learner,
  request: {
    readonly kind: CoachKind
    readonly kinds: ReadonlyArray<CoachKind>
    readonly windows: ReadonlyArray<UsageWindow>
    readonly now: Date
  }
) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      yield* db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update")
      for (const window of request.windows) {
        const [used] = yield* db
          .select({ n: count() })
          .from(coachUsage)
          .where(
            learner.owns(
              coachUsage,
              gte(coachUsage.createdAt, window.since),
              inArray(coachUsage.kind, [...request.kinds])
            )
          )
        if ((used?.n ?? 0) >= window.limit) return Option.some(window)
      }
      yield* db.insert(coachUsage).values({ userId, kind: request.kind, createdAt: request.now })
      return Option.none<UsageWindow>()
    })
  )
}, Effect.orDie)

/** The learner's requests of the given kinds since `since`; coaching and audio are limited separately. */
export const usageSince = (learner: Learner, since: Date, kinds: ReadonlyArray<CoachKind>) =>
  learner.db
    .select({ n: count() })
    .from(coachUsage)
    .where(learner.owns(coachUsage, gte(coachUsage.createdAt, since), inArray(coachUsage.kind, [...kinds])))
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )

export const recordUsage = (learner: Learner, kind: CoachKind, now: Date) =>
  learner.db
    .insert(coachUsage)
    .values({ userId: learner.userId, kind, createdAt: now })
    .pipe(Effect.asVoid, Effect.orDie)
