import type { UserId } from "@kotori/db"
import { boolean, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core"

// Neon owns and migrates neon_auth; keep these read-only table declarations outside @kotori/db so drizzle-kit never includes them in migrations.
export const neonAuth = pgSchema("neon_auth")

export const authUsers = neonAuth.table("user", {
  id: uuid("id").primaryKey().$type<UserId>(),
  email: text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull()
})

export const authSessions = neonAuth.table("session", {
  id: text("id").primaryKey(),
  userId: uuid("userId")
    .$type<UserId>()
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull()
})
