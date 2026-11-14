import type { EntryId, NoteEntry, NoteSense } from "@kotori/contracts"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { entryClips, exampleClips } from "../audio/index.ts"
import { examplesFor, sentencesHeard } from "../enrichment/index.ts"
import { toExample } from "./entries.ts"
import { getEntries } from "./queries.ts"
import { audioUrl } from "./shared.ts"
import { senseLabels } from "./similar.ts"
import { labelsBySense, takeawaysBySense } from "./usage.ts"

/** What a note shows of its entry, every sense in the dictionary's order; the note says which it shows. */
interface Noted {
  readonly entry: NoteEntry
  readonly senses: ReadonlyArray<Omit<NoteSense, "shown">>
}

/**
 * What notes show of their entries, read from the dictionary as it is now, so a draft's approval
 * or new example sentences reach every note that saved it: the headword and its labels, and each
 * sense's glosses, the labels it adds, what is most worth remembering, and its first example. One
 * batch for any number of entries; an entry that is gone is left out.
 */
export const notedEntries = Effect.fn("dictionary.notedEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  const found = new Map<EntryId, Noted>()
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return found
  const records = yield* getEntries(db, wanted)
  const labels = yield* labelsBySense(db, wanted)
  const takeaways = yield* takeawaysBySense(db, wanted)
  const examples = yield* examplesFor(db, wanted)
  const heard = yield* exampleClips(
    db,
    sentencesHeard(examples).map((example) => example.id)
  )
  const clips = yield* entryClips(db, wanted)
  for (const record of records) {
    const own = labels.get(record.id)
    const stated = senseLabels(record.senses.map((_, index) => own?.get(index) ?? []))
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
        labels: stated.word,
        audioUrl: firstClip === undefined ? null : audioUrl(firstClip.key)
      },
      senses: record.senses.map((sense, index) => {
        const example = examples.find((row) => row.entryId === record.id && row.sense === index)
        return {
          index,
          glosses: sense.glosses.map((gloss) => gloss.text),
          labels: stated.senses[index] ?? [],
          note: takeaway?.(index) ?? null,
          example: example === undefined ? null : toExample(example, heard)
        }
      })
    })
  }
  return found
})
