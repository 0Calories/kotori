import { boolean, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Managed Better Auth's tables, declared read-only for typed queries and joins. Neon
 * owns and migrates this schema, so only the columns Kotori reads are listed, with
 * Better Auth's camelCase names. This file is deliberately outside `./schema`, which
 * is all drizzle-kit is pointed at: it must never appear in a migration.
 */
export const neonAuth = pgSchema("neon_auth")

export const authUsers = neonAuth.table("user", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull()
})

export const authSessions = neonAuth.table("session", {
  id: text("id").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull()
})
