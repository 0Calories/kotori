import type { Inflection } from "./tags.ts"

/**
 * The words an English word could be an inflection of, by the regular rules: "parties" →
 * party, "stopped" → stop, "making" → make, "bigger" → big. Irregular forms ("ate") are
 * stored with their words, so this only fills in for words whose source lists no forms.
 * Candidates are guesses; the dictionary decides which exist.
 */
export interface Uninflected {
  readonly base: string
  /** What the word would be: "-s" is a plural for nouns and the third person for verbs. */
  readonly tags: ReadonlyArray<Inflection>
}

const S: ReadonlyArray<Inflection> = ["plural", "third-person"]
const ED: ReadonlyArray<Inflection> = ["past", "past-participle"]
const ING: ReadonlyArray<Inflection> = ["present-participle"]
const ER: ReadonlyArray<Inflection> = ["comparative"]
const EST: ReadonlyArray<Inflection> = ["superlative"]

/** Suffix, what replaces it, and what the suffix makes. */
const RULES: ReadonlyArray<readonly [string, string, ReadonlyArray<Inflection>]> = [
  ["ies", "y", S],
  ["es", "", S],
  ["s", "", S],
  ["ied", "y", ED],
  ["ed", "", ED],
  ["ed", "e", ED],
  ["ying", "ie", ING],
  ["ing", "", ING],
  ["ing", "e", ING],
  ["ier", "y", ER],
  ["er", "", ER],
  ["er", "e", ER],
  ["iest", "y", EST],
  ["est", "", EST],
  ["est", "e", EST]
]

export const uninflect = (word: string): Array<Uninflected> => {
  const lower = word.toLowerCase()
  const candidates: Array<Uninflected> = []
  for (const [suffix, replacement, tags] of RULES) {
    if (!lower.endsWith(suffix) || lower.length <= suffix.length) continue
    const stem = lower.slice(0, -suffix.length)
    // "glass" is not the plural of "glas".
    if (suffix === "s" && stem.endsWith("s")) continue
    candidates.push({ base: stem + replacement, tags })
    // "stopped", "running", "bigger": the consonant doubled before the suffix.
    if (replacement === "" && /([b-df-hj-np-tv-z])\1$/.test(stem)) candidates.push({ base: stem.slice(0, -1), tags })
  }
  const bases = new Map<string, Uninflected>()
  for (const candidate of candidates) {
    if (candidate.base.length > 1 && !bases.has(candidate.base)) bases.set(candidate.base, candidate)
  }
  return [...bases.values()]
}
