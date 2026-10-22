import { Auth, type AuthUser } from "@kotori/auth"
import { type UserRow, UsersRepo } from "@kotori/db"
import { otherLanguage, type Profile, type UpdateProfileRequest, UserId } from "@kotori/domain"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { isTimeZone } from "./time.ts"

/** What the profile shows from the auth user: contact details the row doesn't duplicate. */
type Identity = Pick<AuthUser, "email" | "emailVerified">

export const toProfile = (who: Identity, row: UserRow): Profile => ({
  id: UserId.make(row.id),
  email: who.email,
  emailVerified: who.emailVerified,
  status: row.status,
  role: row.role,
  nativeLanguage: row.nativeLanguage,
  targetLanguage: row.targetLanguage,
  onboarded: row.onboardedAt !== null,
  displayName: row.displayName,
  timezone: row.timezone,
  dailyNewLimit: row.dailyNewLimit,
  dailyReviewLimit: row.dailyReviewLimit,
  createdAt: row.createdAt
})

/** Learner profiles: identity comes from Managed Better Auth; approval, role and preferences live here. */
export class Accounts extends Context.Service<
  Accounts,
  {
    /** The profile for a signed-in user, created with defaults on first sight. */
    profile(user: AuthUser): Effect.Effect<Profile>
    update(current: Profile, request: UpdateProfileRequest): Effect.Effect<Profile>
    /** Removes the learner's data, then their identity and sessions. */
    delete(id: UserId): Effect.Effect<void>
  }
>()("@kotori/api/Accounts") {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const users = yield* UsersRepo
      const auth = yield* Auth

      const profile = Effect.fn("Accounts.profile")(function* (user: AuthUser) {
        const row = yield* users.ensure({
          id: user.id,
          status: "pending",
          role: "user",
          nativeLanguage: "en",
          targetLanguage: "ja",
          onboardedAt: null,
          displayName: user.name.trim() || null,
          timezone: "UTC",
          dailyNewLimit: 20,
          dailyReviewLimit: 200,
          createdAt: yield* Clock.currentTimeMillis
        })
        return toProfile(user, row)
      })

      const update = Effect.fn("Accounts.update")(function* (current: Profile, request: UpdateProfileRequest) {
        const now = yield* Clock.currentTimeMillis
        const updated = yield* users.update(current.id, {
          nativeLanguage: request.nativeLanguage,
          targetLanguage: request.nativeLanguage === undefined ? undefined : otherLanguage(request.nativeLanguage),
          // Picking a language is what completes onboarding.
          onboardedAt: request.nativeLanguage === undefined ? undefined : now,
          displayName: request.displayName === undefined ? undefined : request.displayName?.trim() || null,
          timezone: request.timezone !== undefined && isTimeZone(request.timezone) ? request.timezone : undefined,
          dailyNewLimit: request.dailyNewLimit,
          dailyReviewLimit: request.dailyReviewLimit
        })
        return Option.match(updated, { onNone: () => current, onSome: (row) => toProfile(current, row) })
      })

      const del = Effect.fn("Accounts.delete")(function* (id: UserId) {
        yield* users.delete(id)
        yield* auth.deleteUser(id)
      })

      return Accounts.of({ profile, update, delete: del })
    })
  )
}
