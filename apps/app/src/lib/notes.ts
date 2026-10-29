import type { EntryId, Example, Formality, NoteContent } from "@kotori/domain"
import type { Strings } from "../i18n/strings.ts"

/** A dictionary word saved for review, from the entry page or an English word's page alike. */
export const wordNote = (
  t: Strings,
  word: {
    readonly entryId: EntryId
    readonly sense: number
    readonly headword: string
    readonly reading: string
    readonly glosses: ReadonlyArray<string>
    readonly formality: Formality | null
    readonly example: Example | undefined
    /** The spoken headword, when there is one. */
    readonly audioUrl: string | null
  }
): NoteContent => ({
  kind: "word",
  entryId: word.entryId,
  senseIndex: word.sense,
  headword: word.headword,
  reading: word.reading,
  meaning: word.glosses.slice(0, 3).join("; "),
  hint: word.formality && word.formality !== "neutral" ? t.nuance.scale[word.formality] : null,
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
})
