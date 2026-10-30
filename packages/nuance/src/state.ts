import type { EntryRecord } from "@kotori/db"
import { romanize } from "@kotori/japanese"

export interface CandidateState {
  readonly entryId: number
  readonly word: string
  readonly reading: string
  readonly meaning: string
}

/**
 * The state Jev judges for one sense: the word, this sense's meaning, and the
 * dictionary's own usage notes as evidence. Other senses are included briefly
 * so Jev knows which meaning is in question; nothing else is sent. Meanings are
 * in the other language from the word: English for Japanese, Japanese for English.
 */
export const senseState = (
  entry: EntryRecord,
  senseIndex: number,
  tags: ReadonlyMap<string, string>,
  candidates: ReadonlyArray<CandidateState> = []
) => {
  const sense = entry.senses[senseIndex]!
  const label = (code: string) => tags.get(code) ?? code
  // Inflections ("ate") are the same word; other spellings ("colour") are other forms.
  const otherForms = entry.forms
    .filter((form) => form.kind !== "inflection")
    .map((form) => form.text)
    .filter((text) => text !== entry.headword && text !== entry.reading)
    .slice(0, 4)
  // Kana with its romaji for a Japanese word; an English one's IPA, when the dictionary has it.
  const reading = entry.language === "ja" ? `${entry.reading} (${romanize(entry.reading)})` : entry.reading || undefined

  return {
    word: entry.headword,
    ...(reading === undefined ? {} : { reading }),
    ...(otherForms.length > 0 ? { other_forms: otherForms } : {}),
    meaning: sense.glosses.map((gloss) => gloss.text).join("; "),
    part_of_speech: sense.pos.map(label),
    dictionary_notes: [...sense.misc, ...sense.fields, ...sense.dialects].map(label).concat(sense.info),
    other_meanings: entry.senses
      .filter((_, index) => index !== senseIndex)
      .slice(0, 4)
      .map((other) =>
        other.glosses
          .slice(0, 3)
          .map((gloss) => gloss.text)
          .join("; ")
      ),
    ...(candidates.length > 0
      ? { candidates: candidates.map(({ word, reading, meaning }) => ({ word, reading, meaning })) }
      : {})
  }
}
