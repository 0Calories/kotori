import type { EntryRecord } from "@kotori/db"
import { romanize } from "@kotori/japanese"

/** Senses beyond these rarely matter to learners and are left unclassified. */
export const MAX_SENSES = 6
/** Similar words are looked for on the main senses only. */
export const SIMILAR_SENSES = 3
export const MAX_CANDIDATES = 8

type Sense = EntryRecord["senses"][number]

/** The senses Kotori judges; later ones rarely matter to learners. */
export const judgedSenses = (entry: EntryRecord): ReadonlyArray<Sense> => entry.senses.slice(0, MAX_SENSES)

const leadingGlosses = (sense: Sense | undefined) =>
  (sense?.glosses ?? [])
    .slice(0, 3)
    .map((gloss) => gloss.text)
    .join("; ")

/**
 * What every question about an entry sees: the word, its reading and other spellings, and each
 * judged sense's leading glosses. Nothing sense-specific goes here: a question names its sense
 * in its own instructions (`senseScope`), and `senses` lets it tell that sense from the others.
 * Every question sees the whole state, and unrelated state costs accuracy, so it stays small.
 */
export const entryState = (entry: EntryRecord) => {
  const otherForms = entry.forms
    .map((form) => form.text)
    .filter((text) => text !== entry.headword && text !== entry.reading)
    .slice(0, 4)
  return {
    word: entry.headword,
    reading: `${entry.reading} (${romanize(entry.reading)})`,
    ...(otherForms.length > 0 ? { other_forms: otherForms } : {}),
    senses: judgedSenses(entry).map(leadingGlosses)
  }
}

/**
 * One sense's evidence, carried in the instructions of every question about it: its meaning
 * and the dictionary's own usage notes. Its keys never repeat a state key, since what a
 * backticked name means when both have it is undocumented.
 */
export const senseScope = (entry: EntryRecord, senseIndex: number, tags: ReadonlyMap<string, string>) => {
  const sense = entry.senses[senseIndex]!
  const label = (code: string) => tags.get(code) ?? code
  return {
    meaning: sense.glosses.map((gloss) => gloss.text).join("; "),
    part_of_speech: sense.pos.map(label),
    dictionary_notes: [...sense.misc, ...sense.fields, ...sense.dialects].map(label).concat(sense.info)
  }
}
export type SenseScope = ReturnType<typeof senseScope>

export interface CandidateState {
  readonly entryId: number
  readonly word: string
  readonly reading: string
  readonly meaning: string
}

/** A similar-word candidate as the comparison questions see it: the meaning of its sense that matched. */
export const candidateOf = (candidate: EntryRecord, sense: number): CandidateState => ({
  entryId: candidate.id,
  word: candidate.headword,
  reading: candidate.reading,
  meaning: leadingGlosses(candidate.senses[sense] ?? candidate.senses[0])
})

/** A candidate as its comparison questions carry it, beside the judged sense's `meaning`. */
export const candidateScope = (candidate: CandidateState) => ({
  candidate_word: candidate.word,
  candidate_reading: candidate.reading,
  candidate_meaning: candidate.meaning
})
