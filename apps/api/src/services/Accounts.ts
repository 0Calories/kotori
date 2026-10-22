import { type UserRow, UsersRepo } from "@kotori/db"
import { AccountStatus, otherLanguage, type Profile, type UpdateProfileRequest, UserId } from "@kotori/domain"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { isTimeZone } from "./time.ts"

/** What Kotori needs from Better Auth's user record. */
export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
  readonly name: string
  readonly status: string
  readonly role?: string | null | undefined
}

type Identity = Pick<Profile, "email" | "emailVerified" | "status" | "role">

const decodeStatus = Schema.decodeUnknownOption(AccountStatus)

const identity = (user: AuthUser): Identity => ({
  email: user.email,
  emailVerified: user.emailVerified,
  status: Option.getOrElse(decodeStatus(user.status), () => "pending" as const),
  role: user.role ?? "user"
})

export const toProfile = (who: Identity, row: UserRow): Profile => ({
  id: UserId.make(row.id),
  email: who.email,
  emailVerified: who.emailVerified,
  status: who.status,
  role: who.role,
  nativeLanguage: row.nativeLanguage,
  targetLanguage: row.targetLanguage,
  onboarded: row.onboardedAt !== null,
  displayName: row.displayName,
  timezone: row.timezone,
  dailyNewLimit: row.dailyNewLimit,
  dailyReviewLimit: row.dailyReviewLimit,
  createdAt: row.createdAt
})

/** Learner profiles: identity comes from Better Auth, everything else lives here. */
export class Accounts extends Context.Service<
  Accounts,
  {
    /** The profile for a signed-in user, created with defaults on first sight. */
    profile(user: AuthUser): Effect.Effect<Profile>
    update(current: Profile, request: UpdateProfileRequest): Effect.Effect<Profile>
  }
>()("@kotori/api/Accounts") {
  static readonly layer = Layer.effect(
    Accounts,
    Effect.gen(function* () {
      const users = yield* UsersRepo

      const profile = Effect.fn("Accounts.profile")(function* (user: AuthUser) {
        const row = yield* users.ensure({
          id: user.id,
          nativeLanguage: "en",
          targetLanguage: "ja",
          onboardedAt: null,
          displayName: user.name.trim() || null,
          timezone: "UTC",
          dailyNewLimit: 20,
          dailyReviewLimit: 200,
          createdAt: yield* Clock.currentTimeMillis
        })
        return toProfile(identity(user), row)
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

      return Accounts.of({ profile, update })
    })
  )
}
