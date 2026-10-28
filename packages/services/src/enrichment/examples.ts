import { ExampleWriter } from "@kotori/ai"
import { at, Database } from "@kotori/db"
import { examples } from "@kotori/db/schema"
import { eq, getTableColumns, inArray } from "drizzle-orm"
import { Clock, Effect } from "effect"
import { getEntries, tagLabels } from "../dictionary/entries.ts"
import { EntryNotFound, nuanceFor } from "./nuance.ts"

/** Senses that get example sentences; later senses are rarely what learners look for. */
const EXAMPLE_SENSES = 4

const { createdAt: _, ...exampleColumns } = getTableColumns(examples)

/** Example sentences for the given entries, in order of entry, sense and position. */
export const examplesFor = Effect.fn("enrichment.examplesFor")(function* (entryIds: ReadonlyArray<number>) {
  if (entryIds.length === 0) return []
  const db = yield* Database
  return yield* db
    .select(exampleColumns)
    .from(examples)
    .where(inArray(examples.entryId, entryIds))
    .orderBy(examples.entryId, examples.sense, examples.position)
}, Effect.orDie)

/** Has Claude write example sentences for an entry's main senses, replacing any it had. */
export const writeExamples = Effect.fn("enrichment.writeExamples")(function* (entryId: number) {
  const writer = yield* ExampleWriter
  const [entry] = yield* getEntries([entryId])
  if (entry === undefined) return yield* new EntryNotFound({ entryId })
  const tags = yield* tagLabels
  const label = (code: string) => tags.get(code) ?? code
  const judged = new Map((yield* nuanceFor([entryId])).map((row) => [row.sense, row.nuance]))

  const senses = entry.senses.slice(0, EXAMPLE_SENSES).map((sense, index) => {
    const nuance = judged.get(index)
    return {
      index,
      glosses: sense.glosses.map((gloss) => gloss.text),
      partsOfSpeech: sense.pos.map(label),
      notes: [
        ...[...sense.misc, ...sense.fields, ...sense.dialects].map(label),
        ...sense.info,
        ...(nuance ? [`register: ${nuance.formality.value}, ${nuance.medium.value}`] : [])
      ]
    }
  })
  const written = yield* writer.write({
    headword: entry.headword,
    reading: entry.reading,
    otherForms: entry.forms
      .map((form) => form.text)
      .filter((text) => text !== entry.headword)
      .slice(0, 4),
    senses,
    perSense: senses.length > 2 ? 2 : 3
  })

  const db = yield* Database
  const now = at(yield* Clock.currentTimeMillis)
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        // Audio links cascade from the examples.
        yield* tx.delete(examples).where(eq(examples.entryId, entryId))
        if (written.length === 0) return
        const position = new Map<number, number>()
        yield* tx.insert(examples).values(
          written.map((example) => {
            const next = position.get(example.sense) ?? 0
            position.set(example.sense, next + 1)
            return { entryId, position: next, ...example, model: writer.model, createdAt: now }
          })
        )
      })
    )
    .pipe(Effect.orDie)
  return { examples: written.length }
})
