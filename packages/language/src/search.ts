import { normalizeGloss } from "./english/gloss.ts"
import { normalizeEnglishPhrase } from "./english/phrase.ts"

export const MIN_TRIGRAM_LENGTH = 4

export const TRIGRAM_SPREAD = 0.15

export const TRIGRAM_THRESHOLD = 0.3

const MIN_PHRASE_SIMILARITY = 0.45

export const trigramTargets = (query: string) =>
  [...new Set([normalizeGloss(query), normalizeEnglishPhrase(query)])].filter(
    (target) => target.length >= MIN_TRIGRAM_LENGTH
  )

export const trigramFloor = (query: string) => (/\s/.test(query.trim()) ? MIN_PHRASE_SIMILARITY : 0)

export const nearBest = <A extends { readonly similarity: number }>(matches: ReadonlyArray<A>, minSimilarity = 0) => {
  const floor = Math.max((matches[0]?.similarity ?? 0) - TRIGRAM_SPREAD, minSimilarity)
  return matches.filter((match) => match.similarity >= floor)
}

/** Matches `pg_trgm`'s word framing: two leading spaces, one trailing space, sliced by Unicode code point. */
const trigrams = (text: string) => {
  const found = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const chars = [" ", " ", ...Array.from(word), " "]
    for (let index = 0; index + 3 <= chars.length; index++) found.add(chars.slice(index, index + 3).join(""))
  }
  return found
}

export const trigramSimilarity = (a: string, b: string) => {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const trigram of left) if (right.has(trigram)) shared++
  return shared / (left.size + right.size - shared)
}

export const keepBest = <A extends { readonly score: number }>(hits: Iterable<A>, key: (hit: A) => unknown) => {
  const best = new Map<unknown, A>()
  for (const hit of hits) {
    const current = best.get(key(hit))
    if (current === undefined || hit.score > current.score) best.set(key(hit), hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}
