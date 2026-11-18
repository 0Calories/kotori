import type { EntryId, Language, Note, NoteId, NoteSense } from "@kotori/contracts"

/** One sense of a saved entry: its glosses, and what's worth remembering about it. */
export interface SenseSketch {
  readonly glosses: ReadonlyArray<string>
  readonly takeaway?: string | null
}

/**
 * A note as the API returns it, with only what a test cares about given: the entry's
 * headword, reading and language, and its senses.
 */
export const savedWord = (
  id: string,
  word: {
    readonly entryId?: number
    readonly headword: string
    readonly reading?: string
    readonly language?: Language
    readonly senses?: ReadonlyArray<SenseSketch>
    readonly review?: Note["entry"]["review"]
  }
): Note => {
  const senses = (word.senses ?? [{ glosses: [word.headword] }]).map((sense): NoteSense => ({
    glosses: sense.glosses,
    takeaway: sense.takeaway ?? null
  }))
  return {
    id: id as NoteId,
    createdAt: new Date(0),
    entry: {
      id: (word.entryId ?? 1) as EntryId,
      language: word.language ?? "ja",
      source: "jmdict",
      review: word.review ?? "approved",
      headword: word.headword,
      reading: word.reading ?? word.headword
    },
    senses
  }
}
