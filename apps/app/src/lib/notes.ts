import type { EntryId, Note } from "@kotori/contracts"

// A note is a dictionary entry saved to the learner's notebook.

/** The learner's note on an entry, if they saved it. */
export const noteOn = (notes: ReadonlyArray<Note> | undefined, entryId: EntryId): Note | undefined =>
  notes?.find((note) => note.entry.id === entryId)

/** A sense's glosses run together as its language lists them: "to eat; to dine", "食べる、食事をする". */
export const glossLine = (language: Note["entry"]["language"], glosses: ReadonlyArray<string>, most = 3) =>
  glosses.slice(0, most).join(language === "ja" ? "; " : "、")

/** What a note means, in a line: the glosses of its senses, the first sense's first. */
export const noteMeaning = (note: Note): string =>
  note.senses
    .map((sense) => glossLine(note.entry.language, sense.glosses, 2))
    .join(note.entry.language === "ja" ? " / " : "／")
