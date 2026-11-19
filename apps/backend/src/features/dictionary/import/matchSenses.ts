const SAME_SENSE = 0.5

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
  // JMdict rewords glosses in place far more often than it reorders senses, so keep unmatched senses at their old index when untaken.
  stored.forEach((_, from) => {
    if (moves[from] !== null || from >= incoming.length || taken.has(from)) return
    moves[from] = from
    taken.add(from)
  })
  return moves
}
