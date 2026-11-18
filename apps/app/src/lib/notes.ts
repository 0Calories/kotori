import type { EntryId, Note } from "@kotori/contracts"
import { ApiError } from "../api/errors.ts"
import type { Strings } from "../i18n/strings.ts"

// A note is a dictionary entry saved to the learner's notebook.

/** The learner's note on an entry, if they saved it. */
export const noteOn = (notes: ReadonlyArray<Note> | undefined, entryId: EntryId): Note | undefined =>
  notes?.find((note) => note.entry.id === entryId)

/** What to tell the learner when saving or removing a note didn't work. */
export const noteErrorText = (t: Strings, error: unknown, action: "save" | "remove"): string =>
  error instanceof ApiError && error.tag === "Offline"
    ? t.common.offline
    : action === "remove"
      ? t.notebook.removeFailed
      : t.notebook.saveFailed

/** What a note's senses say, in a line: up to two glosses per sense, the first sense's first. */
export const noteMeaning = (note: Note): string => {
  const glossSeparator = note.entry.language === "ja" ? "; " : "、"
  return note.senses
    .map((sense) => sense.glosses.slice(0, 2).join(glossSeparator))
    .join(note.entry.language === "ja" ? " / " : "／")
}
