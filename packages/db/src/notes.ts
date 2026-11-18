import { index, integer, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { type UserId, users } from "./users.ts"

export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

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
    createdAt: createdAt()
  },
  (t) => [
    index("notes_user").on(t.userId, t.createdAt),
    uniqueIndex("notes_entry").on(t.userId, t.entryId),
    index("notes_entry_id").on(t.entryId)
  ]
)
