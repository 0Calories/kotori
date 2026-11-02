import { boolean, doublePrecision, index, integer, pgEnum, uuid } from "drizzle-orm/pg-core"
import { cardQueue, createdAt, table, timestamptz } from "./columns.ts"
import { notes } from "./notes.ts"
import { users } from "./users.ts"

export const cardTemplate = pgEnum("card_template", ["recognize", "produce"])

/** One side of a note to review, with its spaced-repetition state. */
export const cards = table(
  "cards",
  {
    id: uuid().primaryKey().defaultRandom(),
    noteId: uuid()
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** recognize shows the target language. produce remains in the enum; a migration deletes those rows. */
    template: cardTemplate().notNull(),
    queue: cardQueue().notNull().default("new"),
    due: timestamptz().notNull(),
    /** Days between reviews once the card graduates. */
    interval: integer().notNull().default(0),
    ease: doublePrecision().notNull().default(0),
    /** Position in the learning steps while in `learning` or `relearning`. */
    step: integer().notNull().default(0),
    reps: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    leech: boolean().notNull().default(false),
    lastReview: timestamptz(),
    /** Random tie-breaker so due cards don't always come in the same order. */
    seed: integer().notNull(),
    /** Order new cards are introduced in. */
    position: integer().notNull(),
    createdAt: createdAt()
  },
  (t) => [index("cards_queue").on(t.userId, t.queue, t.due), index("cards_note").on(t.noteId)]
)
