const STOPWORDS = new Set([
  "a", "an", "the", "i", "me", "my", "you", "your", "we", "our", "they", "them", "their",
  "to", "of", "in", "on", "at", "for", "from", "with", "and", "or", "but", "if", "so",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing",
  "how", "what", "whats", "where", "when", "why", "who", "which",
  "can", "could", "would", "should",
  "please", "just", "this", "that", "it", "its",
  "im", "ive", "id", "dont",
  "something", "somewhere",
  "really", "very", "some", "any", "only", "still", "about", "into", "over",
  "have", "has", "had", "get", "got",
  "want", "need", "like", "say", "said", "tell", "told", "ask", "way",
  "take", "took", "taken", "off", "little", "too"
])

/** "asked" and "asking" are the same stopword as "ask". "talk" does not start with "take". */
const isStop = (word: string) =>
  STOPWORDS.has(word) || ["ask", "say", "tell", "take"].some((stem) => word.startsWith(stem))

const latinWords = (text: string) =>
  (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).map((word) => word.replaceAll("'", ""))

const splitGlued = (token: string) => {
  for (const trailer of ["you", "please"]) {
    if (token.endsWith(trailer) && token.length - trailer.length >= 4) {
      return [token.slice(0, -trailer.length), trailer]
    }
  }
  return [token]
}

/** Content words for a partial keyword match. Stopwords and glued forms ("thankyou") are split out. */
export const contentTokens = (query: string) => {
  const out: string[] = []
  for (const word of latinWords(query).flatMap(splitGlued)) {
    if (word.length < 3 || isStop(word)) continue
    if (word.endsWith("s") && STOPWORDS.has(word.slice(0, -1))) continue
    if (!out.includes(word)) out.push(word)
  }
  return out
}

/** Tokens stored on a situation, used only for typo matching when FTS misses. */
export const documentTokens = (text: string) => {
  const out: string[] = []
  for (const word of latinWords(text)) {
    if (word.length < 4 || out.includes(word)) continue
    out.push(word)
  }
  return out
}

/** One Latin word, such as "station". Japanese queries are never single-word in this sense. */
export const isSingleLatinWord = (query: string) => {
  if (/[぀-ヿ㐀-䶿一-鿿]/.test(query)) return false
  return latinWords(query).length === 1
}

/** FTS5 AND-query over every Latin token, including stopwords. Empty when the query has none. */
export const englishFtsMatch = (query: string) => {
  const words = latinWords(query)
  return words.length === 0 ? null : words.map((word) => `"${word}"`).join(" ")
}

/** Damerau-Levenshtein, capped. Transpositions count as one edit so "laet" matches "late". */
export const editDistance = (left: string, right: string) => {
  const n = left.length
  const m = right.length
  if (Math.abs(n - m) > 2) return 3
  const rows: Uint16Array[] = []
  for (let i = 0; i <= n; i++) {
    const row = new Uint16Array(m + 1)
    row[0] = i
    rows.push(row)
  }
  const first = rows[0]!
  for (let j = 0; j <= m; j++) first[j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1)
      }
      rows[i]![j] = best
    }
  }
  return rows[n]![m]!
}

const fuzzyToken = (query: string, candidate: string) => {
  if (query.length < 4 || candidate.length < 4) return false
  if (query[0] !== candidate[0]) return false
  if (Math.abs(query.length - candidate.length) > 1) return false
  return query === candidate || editDistance(query, candidate) <= 1
}

/** Situation ids whose indexed text is within one edit of `token`. */
export const fuzzyHits = (
  token: string,
  docs: readonly { readonly id: string; readonly tokens: readonly string[] }[]
) => {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const doc of docs) {
    if (seen.has(doc.id)) continue
    if (!doc.tokens.some((candidate) => fuzzyToken(token, candidate))) continue
    seen.add(doc.id)
    ids.push(doc.id)
  }
  return ids
}

export interface TokenHit {
  readonly token: string
  readonly id: string
  /** The indexed phrase the token was found in. Tokens must share a phrase. */
  readonly field: string
  readonly rank: number
}

/** Words spread across this many situations are glue ("someone") and do not count. */
const COMMON_DF = 15

/**
 * Rank situations by how many content words they share, anywhere in their phrases.
 * A query with two or more content words must share at least two. One content word
 * counts only when it belongs to a single situation, unless it is a typo (rank >= 40).
 */
export const rankOverlap = (tokens: readonly string[], hits: readonly TokenHit[], limit: number) => {
  const docs = new Map<string, Set<string>>()
  for (const hit of hits) {
    const row = docs.get(hit.token) ?? new Set<string>()
    row.add(hit.id)
    docs.set(hit.token, row)
  }
  const common = new Set([...docs].filter(([, ids]) => ids.size >= COMMON_DF).map(([token]) => token))
  const useful = hits.filter((hit) => !common.has(hit.token))
  const considered = tokens.filter((token) => !common.has(token))
  if (considered.length === 0) return []
  if (tokens.length === 1) {
    const only = considered[0]!
    const fuzzy = useful.some((hit) => hit.token === only && hit.rank >= 40)
    if ((docs.get(only)?.size ?? 0) !== 1 && !fuzzy) return []
  }

  const bestRank = new Map<string, number>()
  const matched = new Map<string, Set<string>>()
  for (const hit of useful) {
    const key = `${hit.id}\0${hit.token}`
    const rank = bestRank.get(key)
    if (rank === undefined || hit.rank < rank) bestRank.set(key, hit.rank)
    const tokensHit = matched.get(hit.id) ?? new Set<string>()
    tokensHit.add(hit.token)
    matched.set(hit.id, tokensHit)
  }

  const required = tokens.length >= 2 ? 2 : 1
  const rows: { id: string; count: number; weight: number }[] = []
  for (const [id, tokensHit] of matched) {
    if (tokensHit.size < required) continue
    let weight = 0
    for (const token of tokensHit) {
      const df = docs.get(token)?.size ?? 1
      weight += (1 / df) * (1 / (1 + (bestRank.get(`${id}\0${token}`) ?? 0)))
    }
    rows.push({ id, count: tokensHit.size, weight })
  }
  rows.sort((a, b) => b.count - a.count || b.weight - a.weight || a.id.localeCompare(b.id))
  return rows.slice(0, limit).map((row) => row.id)
}

/** Reciprocal rank fusion constant. Rank is 1-based. */
export const RRF_K = 60

/**
 * Accept a situation when its fused score is at least this.
 * Score is RRF scaled so rank 1 on both lists is 1, then multiplied by cosine.
 * Partial keyword overlap lifts paraphrases and typos to about 0.83–0.93.
 * Uncovered questions stay at or below 0.45. The 84-query eval is flat from
 * 0.48 to 0.80, so 0.60 sits in the middle. Single Latin words fall back
 * regardless of score.
 */
export const SCORE_THRESHOLD = 0.6

/** Single English words stay on the dictionary. Other queries fall back when the top score is low. */
export const shouldFallback = (query: string, topScore: number) =>
  isSingleLatinWord(query) || topScore < SCORE_THRESHOLD

export interface VectorHit {
  readonly id: string
  readonly cosine: number
}

export interface FusedHit {
  readonly id: string
  readonly score: number
  readonly rrf: number
  readonly cosine: number | null
  readonly keywordRank: number | null
  readonly vectorRank: number | null
}

const perfectRrf = 2 / (RRF_K + 1)

/** Merge a keyword ranking and a vector ranking. Higher score is better. */
export const fuse = (keyword: readonly string[], vector: readonly VectorHit[]): FusedHit[] => {
  const keywordRank = new Map<string, number>()
  for (const id of keyword) {
    if (!keywordRank.has(id)) keywordRank.set(id, keywordRank.size + 1)
  }

  const byCosine = [...vector].sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id))
  const vectorRank = new Map<string, { readonly rank: number; readonly cosine: number }>()
  for (const hit of byCosine) {
    if (!vectorRank.has(hit.id)) vectorRank.set(hit.id, { rank: vectorRank.size + 1, cosine: hit.cosine })
  }

  const rows: FusedHit[] = []
  for (const id of new Set([...keywordRank.keys(), ...vectorRank.keys()])) {
    const kr = keywordRank.get(id) ?? null
    const vr = vectorRank.get(id) ?? null
    const rrf = (kr === null ? 0 : 1 / (RRF_K + kr)) + (vr === null ? 0 : 1 / (RRF_K + vr.rank))
    const cosine = vr?.cosine ?? null
    rows.push({
      id,
      rrf,
      cosine,
      keywordRank: kr,
      vectorRank: vr?.rank ?? null,
      score: (rrf / perfectRrf) * (cosine ?? 0)
    })
  }
  rows.sort((a, b) => b.score - a.score || b.rrf - a.rrf || a.id.localeCompare(b.id))
  return rows
}

/** Cosine for L2-normalised vectors, also used when sqlite-vec isn't loaded. */
export const cosine = (left: Float32Array, right: Float32Array) => {
  const n = Math.min(left.length, right.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += left[i]! * right[i]!
  return dot
}

export const rankByCosine = (
  query: Float32Array,
  rows: readonly { readonly id: string; readonly vector: Float32Array }[],
  limit: number
): VectorHit[] => {
  const best = new Map<string, number>()
  for (const row of rows) {
    const score = cosine(query, row.vector)
    const current = best.get(row.id)
    if (current === undefined || score > current) best.set(row.id, score)
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, score]) => ({ id, cosine: score }))
}
