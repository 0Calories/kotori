import { index, integer, pgEnum, uuid } from "drizzle-orm/pg-core"
import { createdAt, table } from "./columns.ts"
import { users } from "./users.ts"

export const coachKind = pgEnum("coach_kind", ["naturalness", "how-to-say", "speak"])

/** One row per coach request, for the per-learner hourly rate limit. */
export const coachUsage = table(
  "coach_usage",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: coachKind().notNull(),
    createdAt: createdAt()
  },
  (t) => [index("coach_usage_user").on(t.userId, t.createdAt)]
)
