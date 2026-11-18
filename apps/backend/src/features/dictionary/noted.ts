import type { EntryId, NoteEntry, NoteSense } from "@kotori/contracts"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { getEntries } from "./queries.ts"
import { unique } from "./shared.ts"
import { takeawaysBySense } from "./usage.ts"

/** What a note shows of its entry in the notebook, every sense in the dictionary's order. */
interface Noted {
  readonly entry: NoteEntry
  readonly senses: ReadonlyArray<NoteSense>
}

/**
 * What notes show of their entries, read from the dictionary as it is now, so a drafted entry's
 * approval or new cautions reach every learner who saved it: the entry and each sense's glosses and
 * takeaway. One batch for any number of entries; an entry that is gone is left out.
 */
export const notedEntries = Effect.fn("dictionary.notedEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  const found = new Map<EntryId, Noted>()
  const wanted = unique(ids)
  if (wanted.length === 0) return found
  const records = yield* getEntries(db, wanted)
  const takeaways = yield* takeawaysBySense(db, wanted)
  for (const record of records) {
    const takeaway = takeaways.get(record.id)
    found.set(record.id, {
      entry: {
        id: record.id,
        language: record.language,
        source: record.source,
        review: record.review,
        headword: record.headword,
        reading: record.reading
      },
      senses: record.senses.map((sense, index) => ({
        glosses: sense.glosses.map((gloss) => gloss.text),
        takeaway: takeaway?.(index) ?? null
      }))
    })
  }
  return found
})
