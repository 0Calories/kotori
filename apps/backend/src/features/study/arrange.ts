import type { NoteSense } from "@kotori/contracts"

/**
 * A note's senses as it shows them: those the learner chose (`layout`), in their order, then the
 * rest hidden, in the dictionary's. Chosen senses the entry no longer has are passed over; a note
 * left with none, or that never chose (null), shows every sense in the dictionary's order.
 */
export const arrange = (
  senses: ReadonlyArray<Omit<NoteSense, "shown">>,
  layout: ReadonlyArray<number> | null
): { readonly senses: ReadonlyArray<NoteSense>; readonly arranged: boolean } => {
  const chosen = [...new Set(layout ?? [])].filter((index) => senses[index] !== undefined)
  if (chosen.length === 0) return { senses: senses.map((sense) => ({ ...sense, shown: true })), arranged: false }
  return {
    senses: [
      ...chosen.map((index) => ({ ...senses[index]!, shown: true })),
      ...senses.filter((sense) => !chosen.includes(sense.index)).map((sense) => ({ ...sense, shown: false }))
    ],
    arranged: true
  }
}

/** Why a choice of senses can't be kept, or null when it can: each a sense the entry has, once. */
export const layoutProblem = (layout: ReadonlyArray<number>, senseCount: number): string | null => {
  if (layout.length === 0) return "A note shows at least one sense"
  if (new Set(layout).size !== layout.length) return "Each sense can be shown once"
  if (layout.some((index) => !Number.isInteger(index) || index < 0 || index >= senseCount))
    return "That entry has no such sense"
  return null
}
