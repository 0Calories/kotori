import * as Schema from "effect/Schema"
import { Language } from "./Language.ts"

/** Better Auth's user id; the learner profile and all study data are keyed by it. */
export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

/** Anyone can sign up; Ash approves accounts before they can use Kotori. Archived requests look pending to the learner. */
export const AccountStatus = Schema.Literals(["pending", "approved", "archived"])
export type AccountStatus = typeof AccountStatus.Type

export const Profile = Schema.Struct({
  id: UserId,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  status: AccountStatus,
  role: Schema.String,
  nativeLanguage: Language,
  targetLanguage: Language,
  /** Whether the learner has picked a language yet; the app shows the picker until they do. */
  onboarded: Schema.Boolean,
  displayName: Schema.NullOr(Schema.String),
  /** IANA time zone; study days roll over at 4am local time. */
  timezone: Schema.String,
  dailyNewLimit: Schema.Int,
  dailyReviewLimit: Schema.Int,
  createdAt: Schema.Number
})
export type Profile = typeof Profile.Type

const Limit = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 9999 })))

export const UpdateProfileRequest = Schema.Struct({
  nativeLanguage: Schema.optional(Language),
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  timezone: Schema.optional(Schema.String),
  dailyNewLimit: Schema.optional(Limit),
  dailyReviewLimit: Schema.optional(Limit)
})
export type UpdateProfileRequest = typeof UpdateProfileRequest.Type
