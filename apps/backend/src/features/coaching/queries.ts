import { coachCache, coachUsage, users } from "@kotori/db"
import { and, count, eq, gte, inArray } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import type { Learner } from "../../db/scopedToUser.ts"

export type CoachKind = typeof coachUsage.$inferSelect.kind

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

export interface UsageWindow {
  readonly since: Date
  readonly limit: number
}

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
      // Serialize concurrent rate-limit checks per learner by locking their users row.
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
