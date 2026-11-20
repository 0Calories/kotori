export type EnglishInflection =
  | "plural"
  | "third-person"
  | "past"
  | "past-participle"
  | "present-participle"
  | "comparative"
  | "superlative"

export interface Uninflected {
  readonly base: string
  readonly tags: ReadonlyArray<EnglishInflection>
}

const S: ReadonlyArray<EnglishInflection> = ["plural", "third-person"]
const ED: ReadonlyArray<EnglishInflection> = ["past", "past-participle"]
const ING: ReadonlyArray<EnglishInflection> = ["present-participle"]
const ER: ReadonlyArray<EnglishInflection> = ["comparative"]
const EST: ReadonlyArray<EnglishInflection> = ["superlative"]

const RULES: ReadonlyArray<readonly [string, string, ReadonlyArray<EnglishInflection>]> = [
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
    if (suffix === "s" && stem.endsWith("s")) continue
    candidates.push({ base: stem + replacement, tags })
    if (replacement === "" && /([b-df-hj-np-tv-z])\1$/.test(stem)) candidates.push({ base: stem.slice(0, -1), tags })
  }
  const bases = new Map<string, Uninflected>()
  for (const candidate of candidates) {
    if (candidate.base.length > 1 && !bases.has(candidate.base)) bases.set(candidate.base, candidate)
  }
  return [...bases.values()]
}
