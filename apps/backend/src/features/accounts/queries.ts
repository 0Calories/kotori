import { type UserId, users } from "@kotori/db"
import { eq, inArray } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

/**
 * A learner profile. Identity (email, credentials, sessions) lives in Neon's Managed Better
 * Auth; `id` is its user id. Approval `status` and `role` are Kotori's own, since the managed
 * user record has no custom fields.
 */
export type User = typeof users.$inferSelect

/** Fields to change; undefined leaves a field as it is. */
export type UserPatch = Partial<
  Pick<
    typeof users.$inferInsert,
    | "status"
    | "role"
    | "nativeLanguage"
    | "targetLanguage"
    | "onboardedAt"
    | "displayName"
    | "timezone"
    | "dailyNewLimit"
    | "dailyReviewLimit"
  >
>

export const userById = (db: DatabaseShape, id: UserId) =>
  db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

export const usersByIds = (db: DatabaseShape, ids: ReadonlyArray<UserId>) =>
  ids.length === 0 ? Effect.succeed([]) : db.select().from(users).where(inArray(users.id, ids)).pipe(Effect.orDie)

/** Creates the profile if it doesn't exist yet, and returns it either way. */
export const ensureUser = Effect.fn("accounts.ensureUser")(function* (
  db: DatabaseShape,
  user: typeof users.$inferInsert
) {
  yield* db.insert(users).values(user).onConflictDoNothing().pipe(Effect.orDie)
  const row = yield* userById(db, user.id)
  return yield* Option.match(row, {
    onNone: () => Effect.die(new Error(`The profile ${user.id} was deleted while it was being created`)),
    onSome: Effect.succeed
  })
})

export const updateUser = Effect.fn("accounts.updateUser")(function* (db: DatabaseShape, id: UserId, patch: UserPatch) {
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  if (Object.keys(fields).length > 0) yield* db.update(users).set(fields).where(eq(users.id, id)).pipe(Effect.orDie)
  return yield* userById(db, id)
})

/** Removes the profile; notes, review logs and coach usage all cascade from it. */
export const deleteUser = (db: DatabaseShape, id: UserId) =>
  db.delete(users).where(eq(users.id, id)).pipe(Effect.asVoid, Effect.orDie)
