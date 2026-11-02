/** How much of one sense's glosses another must share to count as the same sense after an edit. */
const SAME_SENSE = 0.5

/**
 * Where each of an entry's stored senses went in a re-import: the position of the sense with the
 * same glosses, in the same order, or, failing that, of the one sharing the most of them (at
 * least half, by Jaccard). A sense that matches nothing stays where it was, if no other sense
 * took that position, since dictionaries reword senses in place; null means it is gone.
 * Enrichment is keyed by position, so a re-import that reorders senses (the English dictionary
 * ranks them at import) moves each row with its sense rather than leaving it on whatever sense
 * now sits there.
 */
export const matchSenses = (
  stored: ReadonlyArray<ReadonlyArray<string>>,
  incoming: ReadonlyArray<ReadonlyArray<string>>
): Array<number | null> => {
  const moves: Array<number | null> = stored.map(() => null)
  const taken = new Set<number>()
  const key = (glosses: ReadonlyArray<string>) => JSON.stringify(glosses)
  const free = new Map<string, Array<number>>()
  incoming.forEach((glosses, index) => free.set(key(glosses), [...(free.get(key(glosses)) ?? []), index]))
  stored.forEach((glosses, from) => {
    const to = free.get(key(glosses))?.shift()
    if (to === undefined) return
    moves[from] = to
    taken.add(to)
  })
  const pairs: Array<{ readonly from: number; readonly to: number; readonly overlap: number }> = []
  stored.forEach((glosses, from) => {
    if (moves[from] !== null) return
    const own = new Set(glosses)
    incoming.forEach((other, to) => {
      if (taken.has(to)) return
      const shared = other.filter((gloss) => own.has(gloss)).length
      const overlap = shared / new Set([...glosses, ...other]).size
      if (overlap >= SAME_SENSE) pairs.push({ from, to, overlap })
    })
  })
  for (const { from, to } of pairs.sort((a, b) => b.overlap - a.overlap || a.from - b.from || a.to - b.to)) {
    if (moves[from] !== null || taken.has(to)) continue
    moves[from] = to
    taken.add(to)
  }
  // JMDict rewords glosses ("to eat" → "to eat (a meal)") far more often than it moves senses,
  // and dropping a reworded sense would take its examples, audio and saved words with it.
  stored.forEach((_, from) => {
    if (moves[from] !== null || from >= incoming.length || taken.has(from)) return
    moves[from] = from
    taken.add(from)
  })
  return moves
}
