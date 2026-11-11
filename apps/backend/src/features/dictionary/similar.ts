import type { Label, LabelCode, SimilarDifference } from "@kotori/contracts"

/**
 * What the entry page derives from labels instead of asking a model: which labels each sense
 * states, and how a similar word differs. Pure, so the rules are tested on their own.
 */

/** The word's labels are its first sense's; a later sense states only the labels it adds. */
export const senseLabels = (
  labels: ReadonlyArray<ReadonlyArray<Label>>
): { readonly word: ReadonlyArray<Label>; readonly senses: ReadonlyArray<ReadonlyArray<Label>> } => {
  const word = labels[0] ?? []
  const codes = new Set(word.map((label) => label.code))
  return {
    word,
    senses: labels.map((own, index) => (index === 0 ? [] : own.filter((label) => !codes.has(label.code))))
  }
}

/** Labels that make a word sound rough or casual. */
const CASUAL: ReadonlyArray<LabelCode> = ["vulg", "X", "derog", "sl", "net-sl", "m-sl", "col", "fam"]
const FORMAL: ReadonlyArray<LabelCode> = ["form", "pol"]
const OLD: ReadonlyArray<LabelCode> = ["arch", "obs", "dated"]
/** Labels that mark who says a word, or to whom; a word with none of them is plain, the learner's prior. */
const MARKED: ReadonlyArray<LabelCode> = ["hon", "hum", ...FORMAL, ...CASUAL, "male", "fem"]

const has = (codes: ReadonlySet<LabelCode>, wanted: ReadonlyArray<LabelCode>) => wanted.some((code) => codes.has(code))

/**
 * How `other` differs from `own`, read off their senses' labels. Only a label the other word has
 * says how it differs: two words that share a meaning, one marked respectful, casual or British,
 * differ in just that. Keigo first, then register, who says it, region and age. A label only
 * `own` has says nothing about the other word beyond its being unmarked, so dropping a register
 * or gender label makes it the plain word (召し上がる or 食う to 食べる), never the opposite
 * register: お疲れ様 is not "more casual" than ご苦労様. Words whose labels say nothing apart are a "similar meaning".
 */
export const differenceOf = (own: ReadonlyArray<LabelCode>, other: ReadonlyArray<LabelCode>): SimilarDifference => {
  const mine = new Set(own)
  const theirs = new Set(other)
  const gains = (wanted: ReadonlyArray<LabelCode>) => has(theirs, wanted) && !has(mine, wanted)
  if (gains(["hon"])) return "respectful"
  if (gains(["hum"])) return "humble"
  if (gains(CASUAL)) return "more_casual"
  if (gains(FORMAL)) return "more_formal"
  if (has(mine, MARKED) && !has(theirs, MARKED)) return "plain"
  if (gains(["male"])) return "masculine"
  if (gains(["fem"])) return "feminine"
  if (gains(["en-US"])) return "american"
  if (gains(["en-GB"])) return "british"
  if (gains(OLD)) return "older"
  return "similar"
}

/** A word close to a sense, before it is looked up. */
export interface Candidate {
  readonly sense: number
  readonly entryId: number
  /**
   * The sense of the other word that is close: the one sharing the gloss, or the one a
   * cross-reference names; null for a cross-reference that names none.
   */
  readonly otherSense: number | null
  readonly via: "xref" | "gloss"
}

/**
 * The candidates to show: cross-references before shared glosses, each word once, under the
 * first sense it is close to, at most `perSense` a sense and never the entry itself.
 */
export const pickCandidates = (
  entryId: number,
  candidates: ReadonlyArray<Candidate>,
  perSense: number
): Array<Candidate> => {
  const seen = new Set<number>([entryId])
  const count = new Map<number, number>()
  const picked: Array<Candidate> = []
  const ordered = candidates.toSorted((a, b) => a.sense - b.sense || (a.via === b.via ? 0 : a.via === "xref" ? -1 : 1))
  for (const candidate of ordered) {
    if (seen.has(candidate.entryId) || (count.get(candidate.sense) ?? 0) >= perSense) continue
    seen.add(candidate.entryId)
    count.set(candidate.sense, (count.get(candidate.sense) ?? 0) + 1)
    picked.push(candidate)
  }
  return picked
}
