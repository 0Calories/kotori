import type { EntryId, Language, Note, NoteId, NoteSense } from "@kotori/contracts"

/** One sense of a saved word: its glosses, and what's worth remembering about it. */
export interface SenseSketch {
  readonly glosses: ReadonlyArray<string>
  readonly note?: string | null
  readonly shown?: boolean
}

/**
 * A saved word as the API returns it, with only what a test cares about given: the entry's
 * headword, reading and language, and its senses, shown unless said otherwise.
 */
export const savedWord = (
  id: string,
  word: {
    readonly headword: string
    readonly reading?: string
    readonly language?: Language
    readonly senses?: ReadonlyArray<SenseSketch>
    readonly review?: Note["entry"]["review"]
  },
  schedule: Partial<Pick<Note, "retentionStage" | "interval">> = {}
): Note => {
  const senses = (word.senses ?? [{ glosses: [word.headword] }]).map((sense, index): NoteSense => ({
    index,
    glosses: sense.glosses,
    labels: [],
    note: sense.note ?? null,
    example: null,
    shown: sense.shown ?? true
  }))
  return {
    id: id as NoteId,
    createdAt: new Date(0),
    entry: {
      id: 1 as EntryId,
      language: word.language ?? "ja",
      source: "jmdict",
      review: word.review ?? "approved",
      headword: word.headword,
      reading: word.reading ?? word.headword,
      labels: [],
      audioUrl: null
    },
    // Shown senses first, as the API orders them.
    senses: [...senses.filter((sense) => sense.shown), ...senses.filter((sense) => !sense.shown)],
    arranged: senses.some((sense) => !sense.shown),
    retentionStage: schedule.retentionStage ?? "new",
    due: new Date(0),
    interval: schedule.interval ?? 0,
    ease: 2.5,
    reps: 1,
    lapses: 0,
    leech: false
  }
}
