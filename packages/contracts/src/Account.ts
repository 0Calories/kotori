import { accountStatus, UserId, userRole, users } from "@kotori/db"
import { createSelectSchema, createUpdateSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { UserId }

export const AccountStatus = createSelectSchema(accountStatus)
export type AccountStatus = typeof AccountStatus.Type

export const UserRole = createSelectSchema(userRole)
export type UserRole = typeof UserRole.Type

const User = createSelectSchema(users, { id: UserId })

export const Profile = Schema.Struct({
  ...Struct.pick(User.fields, ["id", "status", "role", "nativeLanguage", "targetLanguage", "displayName", "createdAt"]),
  email: Schema.String,
  emailVerified: Schema.Boolean,
  onboarded: Schema.Boolean
})
export type Profile = typeof Profile.Type

const UserUpdate = createUpdateSchema(users)

export const UpdateProfileRequest = Schema.Struct(Struct.pick(UserUpdate.fields, ["nativeLanguage", "displayName"]))
export type UpdateProfileRequest = typeof UpdateProfileRequest.Type
