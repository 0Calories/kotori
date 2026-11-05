import { normalizeGloss } from "./english/gloss.ts"
import { normalizeEnglishPhrase } from "./english/phrase.ts"

// Ranking pieces shared by the dictionary search, which runs them against Postgres, and the
// search of a learner's saved notes, which runs them in the app over the notes it has loaded.

/** Fewer letters than this and a typo is as near to noise as to the word meant: "cta" for "cat". */
export const MIN_TRIGRAM_LENGTH = 4

/** How far below the best match a trigram match may fall: "umbrela" finds umbrella (0.7), not umbra (0.4). */
export const TRIGRAM_SPREAD = 0.15

/** pg_trgm's `%`: the similarity a trigram match needs at least. */
export const TRIGRAM_THRESHOLD = 0.3

/** A phrase with a word changed still shares most of its trigrams; one sharing a word or two doesn't. */
const MIN_PHRASE_SIMILARITY = 0.45

/**
 * What a typo's trigrams are compared with: an English query as typed and with its pronouns and
 * articles stripped (`normalizeEnglishPhrase`). Empty when the query is too short to compare.
 */
export const trigramTargets = (query: string) =>
  [...new Set([normalizeGloss(query), normalizeEnglishPhrase(query)])].filter(
    (target) => target.length >= MIN_TRIGRAM_LENGTH
  )

/** The least similarity a trigram match of `query` may have: a phrase must share most of itself. */
export const trigramFloor = (query: string) => (/\s/.test(query.trim()) ? MIN_PHRASE_SIMILARITY : 0)

/** The matches within `TRIGRAM_SPREAD` of the best, which comes first. */
export const nearBest = <A extends { readonly similarity: number }>(matches: ReadonlyArray<A>, minSimilarity = 0) => {
  const floor = Math.max((matches[0]?.similarity ?? 0) - TRIGRAM_SPREAD, minSimilarity)
  return matches.filter((match) => match.similarity >= floor)
}

/** A text's trigrams as pg_trgm takes them: per word, lowercased, padded with two spaces before and one after. */
const trigrams = (text: string) => {
  const found = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    // By code point, as Postgres counts characters.
    const chars = [" ", " ", ...Array.from(word), " "]
    for (let index = 0; index + 3 <= chars.length; index++) found.add(chars.slice(index, index + 3).join(""))
  }
  return found
}

/** pg_trgm's `similarity`: the share of the two texts' trigrams that both have. "umbrela" and "umbrella": 0.7. */
export const trigramSimilarity = (a: string, b: string) => {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const trigram of left) if (right.has(trigram)) shared++
  return shared / (left.size + right.size - shared)
}

/** Each key's best-scoring hit, best first; ties keep the order they came in. */
export const keepBest = <A extends { readonly score: number }>(hits: Iterable<A>, key: (hit: A) => unknown) => {
  const best = new Map<unknown, A>()
  for (const hit of hits) {
    const current = best.get(key(hit))
    if (current === undefined || hit.score > current.score) best.set(key(hit), hit)
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}
