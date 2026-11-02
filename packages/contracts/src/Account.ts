import { accountStatus, UserId, userRole, users } from "@kotori/db"
import { createSelectSchema, createUpdateSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { UserId }

/** Anyone can sign up; an admin approves accounts before they can use Kotori. Archived requests look pending to the learner. */
export const AccountStatus = createSelectSchema(accountStatus)
export type AccountStatus = typeof AccountStatus.Type

export const UserRole = createSelectSchema(userRole)
export type UserRole = typeof UserRole.Type

const User = createSelectSchema(users, { id: UserId })

/** The learner's profile: Managed Auth's identity joined with Kotori's own learner fields. */
export const Profile = Schema.Struct({
  ...Struct.pick(User.fields, [
    "id",
    "status",
    "role",
    "nativeLanguage",
    "targetLanguage",
    "displayName",
    "timezone",
    "dailyNewLimit",
    "dailyReviewLimit",
    "createdAt"
  ]),
  email: Schema.String,
  emailVerified: Schema.Boolean,
  /** Whether the learner has picked a language yet; the app shows the picker until they do. */
  onboarded: Schema.Boolean
})
export type Profile = typeof Profile.Type

const UserUpdate = createUpdateSchema(users, {
  dailyNewLimit: (limit) => limit.check(Schema.isBetween({ minimum: 0, maximum: 9999 })),
  dailyReviewLimit: (limit) => limit.check(Schema.isBetween({ minimum: 0, maximum: 9999 }))
})

/** What a learner may change about their own profile. */
export const UpdateProfileRequest = Schema.Struct(
  Struct.pick(UserUpdate.fields, ["nativeLanguage", "displayName", "timezone", "dailyNewLimit", "dailyReviewLimit"])
)
export type UpdateProfileRequest = typeof UpdateProfileRequest.Type
