import { otherLanguage, type Profile, type UpdateProfileRequest, type UserId } from "@kotori/contracts"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { Database } from "../../db/Database.ts"
import { Auth, type AuthUser } from "../../integrations/auth/Auth.ts"
import { deleteUser, ensureUser, updateUser, type User } from "./queries.ts"
import { isTimeZone } from "./timeZone.ts"

/** What the profile shows from the auth user: contact details the row doesn't duplicate. */
type Identity = Pick<AuthUser, "email" | "emailVerified">

const toProfile = (who: Identity, row: User): Profile => ({
  id: row.id,
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
    /** Removes the learner's data, their identity and their sessions, all or nothing. */
    delete(id: UserId): Effect.Effect<void>
  }
>()("@kotori/backend/Accounts") {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const db = yield* Database
      const auth = yield* Auth

      const profile = Effect.fn("Accounts.profile")(function* (user: AuthUser) {
        // The table's defaults make a pending learner of English speakers learning Japanese.
        const row = yield* ensureUser(db, {
          id: user.id,
          displayName: user.name.trim() || null,
          createdAt: new Date(yield* Clock.currentTimeMillis)
        })
        return toProfile(user, row)
      })

      const update = Effect.fn("Accounts.update")(function* (current: Profile, request: UpdateProfileRequest) {
        const now = new Date(yield* Clock.currentTimeMillis)
        const updated = yield* updateUser(db, current.id, {
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

      // One transaction: a profile deleted without its identity would be recreated, pending,
      // on the learner's next request.
      const del = Effect.fn("Accounts.delete")(function* (id: UserId) {
        yield* sql.withTransaction(Effect.andThen(deleteUser(db, id), auth.deleteUser(id))).pipe(Effect.orDie)
      })

      return Accounts.of({ profile, update, delete: del })
    })
  )
}
