import type { NoteSense, SenseIndex, SenseLayout } from "@kotori/contracts"
import { Array as Arr } from "effect"

/**
 * A note's senses as it shows them: those the learner chose (`layout`), in their order, then the
 * rest hidden, in the dictionary's. Chosen senses the entry no longer has are passed over; a note
 * left with none, or that never chose (null), shows every sense in the dictionary's order.
 */
export const arrange = (
  senses: ReadonlyArray<Omit<NoteSense, "shown">>,
  layout: SenseLayout
): { readonly senses: ReadonlyArray<NoteSense>; readonly arranged: boolean } => {
  const chosen = Arr.dedupe(layout ?? []).filter((index) => senses[index] !== undefined)
  if (chosen.length === 0) return { senses: senses.map((sense) => ({ ...sense, shown: true })), arranged: false }
  return {
    senses: [
      ...chosen.map((index) => ({ ...senses[index]!, shown: true })),
      ...senses.filter((sense) => !chosen.includes(sense.index)).map((sense) => ({ ...sense, shown: false }))
    ],
    arranged: true
  }
}

/**
 * Whether every chosen sense is one the entry has. `SenseLayout` itself holds the rest of what a
 * layout must be: at least one sense, each once.
 */
export const fitsEntry = (chosen: ReadonlyArray<SenseIndex>, senseCount: number) =>
  chosen.every((index) => index < senseCount)
