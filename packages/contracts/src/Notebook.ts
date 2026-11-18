import { NoteId, notes, UserId } from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { Entry, EntryId } from "./Dictionary.ts"

export { NoteId }

const NoteRow = createSelectSchema(notes, { id: NoteId, userId: UserId, entryId: EntryId })

/** The entry a note saves, as the notebook shows it, read from the dictionary each time. */
export const NoteEntry = Schema.Struct(
  Struct.pick(Entry.fields, ["id", "language", "source", "review", "headword", "reading"])
)
export type NoteEntry = typeof NoteEntry.Type

/** One sense of a note's entry, for showing and searching its glosses in the notebook. */
export const NoteSense = Schema.Struct({
  /** Short renderings of the sense in the other language from the entry. */
  glosses: Schema.Array(Schema.String),
  /** What is most worth remembering about the sense: its caution or the entry's, else its usage. */
  takeaway: Schema.NullOr(Schema.String)
})
export type NoteSense = typeof NoteSense.Type

/** A dictionary entry saved to the learner's notebook. */
export const Note = Schema.Struct({
  ...Struct.pick(NoteRow.fields, ["id", "createdAt"]),
  entry: NoteEntry,
  senses: Schema.Array(NoteSense)
})
export type Note = typeof Note.Type

/**
 * Saves a dictionary entry, unreviewed drafted entries included, to the learner's notebook. Saving
 * an entry again returns its existing note.
 */
export const AddNoteRequest = Schema.Struct({
  entryId: EntryId
})
export type AddNoteRequest = typeof AddNoteRequest.Type
