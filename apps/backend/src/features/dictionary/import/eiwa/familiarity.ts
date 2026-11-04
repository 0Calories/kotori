import { Option, Schema } from "effect"

/**
 * `data/eiwa/familiarity.json`: how familiar each multi-word English entry is to native speakers
 * today, 1–5, by lowercased headword. The subtitle counts (`en_50k.txt`) are of single words, so
 * phrases read backwards from JMDict or Japanese Wiktionary would otherwise rank as unused; the
 * curated entries carry their own rating. Written by `kotori familiarity`, which asks Claude about
 * the phrases the file lacks, and read by the import (`build.ts`), where a rating sets a floor on
 * the phrase's usage count.
 */
export const FAMILIARITY_FILE = "data/eiwa/familiarity.json"

export const FAMILIARITY_MIN = 1
export const FAMILIARITY_MAX = 5

const Ratings = Schema.Record(Schema.String, Schema.Int)

const decodeRatings = Schema.decodeUnknownOption(Schema.fromJsonString(Ratings))

/** The ratings in the file's JSON, by lowercased headword; ratings off the scale are left out. */
export const parseFamiliarity = (json: string): Map<string, number> => {
  const ratings = new Map<string, number>()
  const decoded = decodeRatings(json)
  if (Option.isNone(decoded)) return ratings
  for (const [headword, rating] of Object.entries(decoded.value)) {
    if (rating >= FAMILIARITY_MIN && rating <= FAMILIARITY_MAX) ratings.set(headword.toLowerCase(), rating)
  }
  return ratings
}

/** The file's JSON: one headword a line, in order, so re-rating diffs cleanly. */
export const serializeFamiliarity = (ratings: ReadonlyMap<string, number>): string =>
  `${JSON.stringify(Object.fromEntries([...ratings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`
