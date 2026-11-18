import { NoteId, notes, UserId } from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { Entry, EntryId } from "./Dictionary.ts"

export { NoteId }

const NoteRow = createSelectSchema(notes, { id: NoteId, userId: UserId, entryId: EntryId })

/** The entry a note saves, as the notebook shows it, read from the dictionary each time. */
export const NoteEntry = Schema.Struct(
  Struct.pick(Entry.fields, ["id", "language", "source", "review", "headword", "reading", "audioUrl"])
)
export type NoteEntry = typeof NoteEntry.Type

/** One sense of a note's entry, for showing and searching its meanings in the notebook. */
export const NoteSense = Schema.Struct({
  /** What it means, in the other language from the headword. */
  glosses: Schema.Array(Schema.String),
  /** What is most worth remembering about it: its caution or the word's, else how it is used. */
  note: Schema.NullOr(Schema.String)
})
export type NoteSense = typeof NoteSense.Type

/** A saved note: a dictionary entry saved to the learner's notebook. */
export const Note = Schema.Struct({
  ...Struct.pick(NoteRow.fields, ["id", "createdAt"]),
  entry: NoteEntry,
  senses: Schema.Array(NoteSense)
})
export type Note = typeof Note.Type

/**
 * Saves a dictionary entry, unreviewed drafts included, to the learner's notebook. Saving an entry
 * again returns its existing note.
 */
export const AddNoteRequest = Schema.Struct({
  entryId: EntryId
})
export type AddNoteRequest = typeof AddNoteRequest.Type
