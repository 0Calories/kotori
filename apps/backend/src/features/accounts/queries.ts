import { type UserId, users } from "@kotori/db"
import { eq, inArray } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

export type User = typeof users.$inferSelect

export type UserPatch = Partial<
  Pick<
    typeof users.$inferInsert,
    "status" | "role" | "nativeLanguage" | "targetLanguage" | "onboardedAt" | "displayName"
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

export const deleteUser = (db: DatabaseShape, id: UserId) =>
  db.delete(users).where(eq(users.id, id)).pipe(Effect.asVoid, Effect.orDie)
