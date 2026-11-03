import type { Language } from "@kotori/contracts"

/**
 * What a learner should hear for the headword. Japanese is read from its kana,
 * which pins down words whose kanji is ambiguous; English is the spelling, not the IPA.
 */
export const spokenHeadword = (entry: {
  readonly language: Language
  readonly headword: string
  readonly reading: string
}): string => {
  if (entry.language === "ja") {
    const reading = entry.reading.trim()
    return reading.length > 0 ? reading : entry.headword.trim()
  }
  return entry.headword.trim()
}

/** The example sentence in the language being learned: Japanese for a Japanese word, English for an English one. */
export const spokenExample = (example: { readonly ja: string; readonly en: string }, language: Language): string =>
  (language === "ja" ? example.ja : example.en).trim()
