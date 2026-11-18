import type { EntryId, NoteEntry, NoteSense } from "@kotori/contracts"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { getEntries } from "./queries.ts"
import { unique } from "./shared.ts"
import { takeawaysBySense } from "./usage.ts"

interface Noted {
  readonly entry: NoteEntry
  readonly senses: ReadonlyArray<NoteSense>
}

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
