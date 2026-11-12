import { bigint, doublePrecision, index, integer, pgEnum, uuid } from "drizzle-orm/pg-core"
import { retentionStage, table, timestamptz } from "./columns.ts"
import { type NoteId, notes } from "./notes.ts"
import { type UserId, users } from "./users.ts"

export const rating = pgEnum("rating", ["again", "hard", "good", "easy"])

/** Every review, with the note's schedule before and after, for statistics and tuning. */
export const reviewLogs = table(
  "review_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    noteId: uuid()
      .$type<NoteId>()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: rating().notNull(),
    retentionStageBefore: retentionStage().notNull(),
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
