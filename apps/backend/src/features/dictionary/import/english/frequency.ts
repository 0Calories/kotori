import { Option, Schema } from "effect"

export const FREQUENCY_FILE = "data/english/frequency.json"

export const FREQUENCY_MIN = 1
export const FREQUENCY_MAX = 5

const Ratings = Schema.Record(Schema.String, Schema.Int)

const decodeRatings = Schema.decodeUnknownOption(Schema.fromJsonString(Ratings))

export const parseFrequency = (json: string): Map<string, number> => {
  const ratings = new Map<string, number>()
  const decoded = decodeRatings(json)
  if (Option.isNone(decoded)) return ratings
  for (const [headword, rating] of Object.entries(decoded.value)) {
    if (rating >= FREQUENCY_MIN && rating <= FREQUENCY_MAX) ratings.set(headword.toLowerCase(), rating)
  }
  return ratings
}

export const serializeFrequency = (ratings: ReadonlyMap<string, number>): string =>
  `${JSON.stringify(Object.fromEntries([...ratings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2)}\n`
