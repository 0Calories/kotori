import { NoteId, notes, UserId } from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { Entry, EntryId } from "./Dictionary.ts"

export { NoteId }

const NoteRow = createSelectSchema(notes, { id: NoteId, userId: UserId, entryId: EntryId })

export const NoteEntry = Schema.Struct(
  Struct.pick(Entry.fields, ["id", "language", "source", "review", "headword", "reading"])
)
export type NoteEntry = typeof NoteEntry.Type

export const NoteSense = Schema.Struct({
  glosses: Schema.Array(Schema.String),
  takeaway: Schema.NullOr(Schema.String)
})
export type NoteSense = typeof NoteSense.Type

export const Note = Schema.Struct({
  ...Struct.pick(NoteRow.fields, ["id", "createdAt"]),
  entry: NoteEntry,
  senses: Schema.Array(NoteSense)
})
export type Note = typeof Note.Type

export const AddNoteRequest = Schema.Struct({
  entryId: EntryId
})
export type AddNoteRequest = typeof AddNoteRequest.Type
