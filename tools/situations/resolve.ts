import type { FormMatch } from "@kotori/db"

export interface WordLink {
  readonly word: string
  readonly reading: string
}

export interface EntryRank {
  readonly reading: string
  readonly common: boolean
  readonly priority: number
}

/** Pick a real entry for each headword. Reading breaks ties such as 空く/すく vs 開く/あく. */
export const resolveLinks = (
  words: readonly WordLink[],
  forms: readonly FormMatch[],
  entries: ReadonlyMap<number, EntryRank>
) => {
  const ids: number[] = []
  const missed: WordLink[] = []
  for (const word of words) {
    const candidateIds = [
      ...new Set(
        forms.filter((form) => form.text === word.word || form.text === word.reading).map((form) => form.entryId)
      )
    ]
    const readingMatches = candidateIds.filter((id) => entries.get(id)?.reading === word.reading)
    const pool = readingMatches.length > 0 ? readingMatches : candidateIds
    let best: { id: number; score: number } | null = null
    for (const id of pool) {
      const entry = entries.get(id)
      if (entry === undefined) continue
      const matched = forms.filter((form) => form.entryId === id)
      const score = (matched.some((form) => form.text === word.word) ? 200 : 0) +
        (matched.some((form) => form.text === word.reading) ? 200 : 0) +
        (entry.reading === word.reading ? 400 : 0) +
        (entry.common ? 1000 : 0) +
        entry.priority
      if (best === null || score > best.score) best = { id, score }
    }
    if (best === null) missed.push(word)
    else if (!ids.includes(best.id)) ids.push(best.id)
  }
  return { ids, missed }
}
