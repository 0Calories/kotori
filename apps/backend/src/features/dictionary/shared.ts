import type { EntryRecord } from "@kotori/contracts"

// What both search results and entries show of a word.

export const audioUrl = (key: string) => `/audio/${key}.mp3`

export const unique = <A>(items: Iterable<A>) => [...new Set(items)]

/** The word's first meanings: up to `count` glosses of its first sense, else one of its second. */
export const firstGlosses = (entry: EntryRecord, count: number) => {
  const meanings = entry.senses[0]?.glosses.slice(0, count).map((gloss) => gloss.text) ?? []
  const second = entry.senses[1]?.glosses[0]?.text
  return meanings.length < count && second !== undefined ? [...meanings, second] : meanings
}
