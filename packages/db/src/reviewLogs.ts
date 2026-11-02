import { bigint, doublePrecision, index, integer, pgEnum, uuid } from "drizzle-orm/pg-core"
import { cards } from "./cards.ts"
import { cardQueue, table, timestamptz } from "./columns.ts"
import { users } from "./users.ts"

export const rating = pgEnum("rating", ["again", "hard", "good", "easy"])

/** Every answer, with the card's state before and after, for statistics and tuning. */
export const reviewLogs = table(
  "review_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    cardId: uuid()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: rating().notNull(),
    queueBefore: cardQueue().notNull(),
    intervalBefore: integer().notNull(),
    interval: integer().notNull(),
    easeBefore: doublePrecision().notNull(),
    ease: doublePrecision().notNull(),
    /** How late the review was, in milliseconds (negative when early). */
    delayMs: bigint({ mode: "number" }).notNull(),
    /** How long the learner took to answer, when the client reported it. */
    durationMs: integer(),
    reviewedAt: timestamptz().notNull(),
    /** The learner's local study day (days since epoch, rolling over at 4am), so streaks and "today" don't depend on the server clock. */
    studyDay: integer().notNull()
  },
  (t) => [index("review_logs_user_day").on(t.userId, t.studyDay)]
)
