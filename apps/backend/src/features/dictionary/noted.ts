import type { EntryId, NoteEntry, NoteSense } from "@kotori/contracts"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { entryClips } from "../audio/index.ts"
import { getEntries } from "./queries.ts"
import { audioUrl, unique } from "./shared.ts"
import { takeawaysBySense } from "./usage.ts"

/** What a note shows of its entry in the notebook, every sense in the dictionary's order. */
interface Noted {
  readonly entry: NoteEntry
  readonly senses: ReadonlyArray<NoteSense>
}

/**
 * What notes show of their entries, read from the dictionary as it is now, so a draft's approval
 * or new cautions and audio reach every learner who saved it: the headword and its audio, and each
 * sense's glosses and what is most worth remembering about it. One batch for any number of entries;
 * an entry that is gone is left out.
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
  const clips = yield* entryClips(db, wanted)
  for (const record of records) {
    const takeaway = takeaways.get(record.id)
    const firstClip = clips.get(record.id)?.[0]
    found.set(record.id, {
      entry: {
        id: record.id,
        language: record.language,
        source: record.source,
        review: record.review,
        headword: record.headword,
        reading: record.reading,
        audioUrl: firstClip === undefined ? null : audioUrl(firstClip.key)
      },
      senses: record.senses.map((sense, index) => ({
        glosses: sense.glosses.map((gloss) => gloss.text),
        note: takeaway?.(index) ?? null
      }))
    })
  }
  return found
})
