import type { EntryRecord } from "@kotori/contracts"

export const audioUrl = (key: string) => `/audio/${key}.mp3`

export const unique = <A>(items: Iterable<A>) => [...new Set(items)]

export const firstGlosses = (entry: EntryRecord, count: number) => {
  const meanings = entry.senses[0]?.glosses.slice(0, count).map((gloss) => gloss.text) ?? []
  const second = entry.senses[1]?.glosses[0]?.text
  return meanings.length < count && second !== undefined ? [...meanings, second] : meanings
}
