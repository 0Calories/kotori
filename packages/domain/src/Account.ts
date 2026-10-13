import * as Schema from "effect/Schema"
import { Language } from "./Language.ts"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const Profile = Schema.Struct({
  id: UserId,
  nativeLanguage: Language,
  targetLanguage: Language,
  displayName: Schema.NullOr(Schema.String),
  /** IANA time zone; study days roll over at 4am local time. */
  timezone: Schema.String,
  dailyNewLimit: Schema.Int,
  dailyReviewLimit: Schema.Int,
  createdAt: Schema.Number
})
export type Profile = typeof Profile.Type

export const CreateAccountRequest = Schema.Struct({
  nativeLanguage: Language,
  timezone: Schema.String,
  displayName: Schema.optional(Schema.String)
})
export type CreateAccountRequest = typeof CreateAccountRequest.Type

export const Session = Schema.Struct({
  token: Schema.String,
  profile: Profile
})
export type Session = typeof Session.Type

const Limit = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 9999 })))

export const UpdateProfileRequest = Schema.Struct({
  nativeLanguage: Schema.optional(Language),
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  timezone: Schema.optional(Schema.String),
  dailyNewLimit: Schema.optional(Limit),
  dailyReviewLimit: Schema.optional(Limit)
})
export type UpdateProfileRequest = typeof UpdateProfileRequest.Type
