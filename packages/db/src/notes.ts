import { index, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, table } from "./columns.ts"
import { entries } from "./entries.ts"
import type { EntryId } from "./entryDocument.ts"
import { type UserId, users } from "./users.ts"

/** A saved note's id. */
export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

/** A dictionary entry a learner saved to their notebook. */
export const notes = table(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom().$type<NoteId>(),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: text()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    createdAt: createdAt()
  },
  (t) => [
    index("notes_user").on(t.userId, t.createdAt),
    uniqueIndex("notes_entry").on(t.userId, t.entryId),
    index("notes_entry_id").on(t.entryId)
  ]
)
