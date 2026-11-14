import { boolean, doublePrecision, index, integer, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, retentionStage, table, timestamptz } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { type UserId, users } from "./users.ts"

/** A saved note's id. */
export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

/**
 * A dictionary entry a learner saved to study, with its place in the review schedule. The note
 * holds nothing of the entry's own: what a review shows is read from the entry each time, so
 * enrichment and an admin's approval reach every learner who saved it. A learner saves an entry
 * once, whatever its review state, and chooses which of its senses the note shows, in what order.
 */
export const notes = table(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom().$type<NoteId>(),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    /**
     * The senses the note shows (by index), in the learner's order; the rest are hidden. Null
     * shows every sense in the dictionary's order, including senses the entry gains later.
     */
    senses: integer().array(),
    retentionStage: retentionStage().notNull().default("new"),
    due: timestamptz().notNull(),
    /** Days between reviews once the note graduates. */
    interval: integer().notNull().default(0),
    ease: doublePrecision().notNull().default(0),
    /** Position in the learning steps while in `learning` or `relearning`. */
    step: integer().notNull().default(0),
    reps: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    leech: boolean().notNull().default(false),
    lastReview: timestamptz(),
    /** Random tie-breaker so due notes don't always come in the same order. */
    seed: integer().notNull(),
    /** Order new notes are introduced in. */
    position: integer().notNull(),
    createdAt: createdAt()
  },
  (t) => [
    index("notes_user").on(t.userId, t.createdAt),
    index("notes_due").on(t.userId, t.retentionStage, t.due),
    uniqueIndex("notes_entry").on(t.userId, t.entryId),
    index("notes_entry_id").on(t.entryId)
  ]
)
