import type { EntryId, Example, Language, NoteContent } from "@kotori/contracts"

/** A dictionary word saved for review, from the entry page. */
export const wordNote = (word: {
  readonly entryId: EntryId
  /** The headword's language: the one being learned. */
  readonly language: Language
  readonly sense: number
  readonly headword: string
  readonly reading: string
  readonly glosses: ReadonlyArray<string>
  /** The sense's register labels, worded, shown as a hint on production cards. */
  readonly hint: string | null
  /** The note most worth remembering, in the learner's language. */
  readonly note: string | null
  readonly example: Example | undefined
  /** The spoken headword, when there is one. */
  readonly audioUrl: string | null
}): NoteContent => {
  return {
    kind: "word",
    entryId: word.entryId,
    senseIndex: word.sense,
    language: word.language,
    headword: word.headword,
    reading: word.reading,
    meaning: word.glosses.slice(0, 3).join(word.language === "ja" ? "; " : "、"),
    hint: word.hint,
    note: word.note,
    example: word.example
      ? {
          ja: word.example.ja,
          furigana: word.example.furigana,
          en: word.example.en,
          audioUrl: word.example.audioUrl,
          translationAudioUrl: word.example.translationAudioUrl
        }
      : null,
    audioUrl: word.audioUrl
  }
}
