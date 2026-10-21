/** FTS5 AND-query over the Latin tokens of a situation search. Japanese is matched separately. */
export const englishFtsMatch = (query: string) => {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const latin = words.filter((word) => /[a-z0-9]/i.test(word))
  return latin.length === 0 ? null : latin.map((word) => `"${word.replaceAll("\"", "")}"`).join(" ")
}

/** Reciprocal rank fusion constant. Rank is 1-based. */
export const RRF_K = 60

/**
 * Accept a situation when its fused score is at least this.
 * Score is RRF scaled so rank-1 on both lists is 1, then multiplied by cosine
 * (0 when the hit never appeared in the vector list). Tuned on the prototype
 * eval: vector-only paraphrases land near 0.42 and unseen "how do I…" questions
 * land in the same band, so the gate stays strict and lets those fall through
 * to the model. See the PR notes.
 */
export const SCORE_THRESHOLD = 0.55

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
