import { index, pgEnum, text, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, language, table, timestamptz } from "./columns.ts"

export const accountStatus = pgEnum("account_status", ["pending", "approved", "archived"])

export const userRole = pgEnum("user_role", ["user", "admin"])

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

/** Keyed by Managed Better Auth's `neon_auth.user.id` without a foreign key because Neon owns `neon_auth` migrations. */
export const users = table(
  "users",
  {
    id: uuid().primaryKey().$type<UserId>(),
    status: accountStatus().notNull().default("pending"),
    role: userRole().notNull().default("user"),
    nativeLanguage: language().notNull().default("en"),
    targetLanguage: language().notNull().default("ja"),
    onboardedAt: timestamptz(),
    displayName: text(),
    createdAt: createdAt()
  },
  (t) => [index("users_status").on(t.status)]
)
