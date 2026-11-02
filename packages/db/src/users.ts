import { index, integer, pgEnum, text, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, language, table, timestamptz } from "./columns.ts"

export const accountStatus = pgEnum("account_status", ["pending", "approved", "archived"])

export const userRole = pgEnum("user_role", ["user", "admin"])

/** Managed Auth's user id: the learner profile and all study data are keyed by it. */
export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

/**
 * The learner profile. Identity (email, credentials, sessions) is Managed Better Auth's,
 * in the `neon_auth` schema of the same database; `id` is its user id and the row is
 * created on the learner's first request. Approval `status` and `role` are Kotori's own.
 * No foreign key into `neon_auth`: that schema is Neon's to change.
 */
export const users = table(
  "users",
  {
    id: uuid().primaryKey().$type<UserId>(),
    status: accountStatus().notNull().default("pending"),
    role: userRole().notNull().default("user"),
    nativeLanguage: language().notNull().default("en"),
    targetLanguage: language().notNull().default("ja"),
    /** When the learner picked a language; null until onboarding is done. */
    onboardedAt: timestamptz(),
    displayName: text(),
    /** IANA time zone; study days roll over at 4am local time. */
    timezone: text().notNull().default("UTC"),
    dailyNewLimit: integer().notNull().default(20),
    dailyReviewLimit: integer().notNull().default(200),
    createdAt: createdAt()
  },
  (t) => [index("users_status").on(t.status)]
)
