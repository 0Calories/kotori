import type { AccountStatus, Language } from "@kotori/domain"
import { eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at, atOrNull, millis, millisOrNull } from "./rows.ts"
import { userRole, users } from "./schema/index.ts"

export type UserRole = (typeof userRole.enumValues)[number]

/**
 * The learner profile. Identity (email, credentials, sessions) lives in Neon's
 * Managed Better Auth; `id` is its user id. Approval `status` and `role` are
 * Kotori's own, since the managed user record has no custom fields.
 */
export interface UserRow {
  readonly id: string
  readonly status: AccountStatus
  readonly role: UserRole
  readonly nativeLanguage: Language
  readonly targetLanguage: Language
  /** When the learner picked a language; null until onboarding is done. */
  readonly onboardedAt: number | null
  readonly displayName: string | null
  readonly timezone: string
  readonly dailyNewLimit: number
  readonly dailyReviewLimit: number
  readonly createdAt: number
}

/** Fields to change; undefined leaves a field as it is. */
export type UserPatch = {
  readonly [
    K in
      | "status"
      | "role"
      | "nativeLanguage"
      | "targetLanguage"
      | "onboardedAt"
      | "displayName"
      | "timezone"
      | "dailyNewLimit"
      | "dailyReviewLimit"
  ]?: UserRow[K] | undefined
}

const toRow = (user: typeof users.$inferSelect): UserRow => ({
  ...user,
  onboardedAt: millisOrNull(user.onboardedAt),
  createdAt: millis(user.createdAt)
})

export class UsersRepo extends Context.Service<
  UsersRepo,
  {
    /** Creates the profile if it doesn't exist yet and returns it either way. */
    ensure(user: UserRow): Effect.Effect<UserRow>
    byId(id: string): Effect.Effect<Option.Option<UserRow>>
    byIds(ids: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<UserRow>>
    update(id: string, patch: UserPatch): Effect.Effect<Option.Option<UserRow>>
    /** Removes the profile and everything the learner saved or studied. */
    delete(id: string): Effect.Effect<void>
  }
>()("@kotori/db/UsersRepo") {
  static readonly layer = Layer.effect(
    UsersRepo,
    Effect.gen(function* () {
      const db = yield* Database

      const byId = (id: string) =>
        db
          .select()
          .from(users)
          .where(eq(users.id, id))
          .pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0]).pipe(Option.map(toRow))),
            Effect.orDie
          )

      const byIds = Effect.fn("UsersRepo.byIds")(function* (ids: ReadonlyArray<string>) {
        if (ids.length === 0) return []
        const rows = yield* db.select().from(users).where(inArray(users.id, ids))
        return rows.map(toRow)
      }, Effect.orDie)

      const ensure = Effect.fn("UsersRepo.ensure")(function* (user: UserRow) {
        yield* db
          .insert(users)
          .values({ ...user, onboardedAt: atOrNull(user.onboardedAt), createdAt: at(user.createdAt) })
          .onConflictDoNothing()
          .pipe(Effect.orDie)
        return Option.getOrElse(yield* byId(user.id), () => user)
      })

      const update = Effect.fn("UsersRepo.update")(function* (id: string, patch: UserPatch) {
        const { onboardedAt, ...rest } = patch
        const fields = {
          ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
          ...(onboardedAt === undefined ? {} : { onboardedAt: atOrNull(onboardedAt) })
        }
        if (Object.keys(fields).length > 0) {
          yield* db.update(users).set(fields).where(eq(users.id, id)).pipe(Effect.orDie)
        }
        return yield* byId(id)
      })

      // Notes, cards, review logs and coach usage all cascade from the profile.
      const del = (id: string) => db.delete(users).where(eq(users.id, id)).pipe(Effect.asVoid, Effect.orDie)

      return UsersRepo.of({ ensure, byId, byIds, update, delete: del })
    })
  )
}
