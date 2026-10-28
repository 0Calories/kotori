import { chunks, Database } from "@kotori/db"
import { entries, forms, glosses, senses, tags } from "@kotori/db/schema"
import { type EntryRecord, JMDict, type JMDictTag, parseEntries, parseTags } from "@kotori/jmdict"
import { and, gte, inArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { normalizeGloss } from "./entries.ts"

/** Inserts or replaces entries and their forms, senses and glosses. Enrichment survives for every sense the entry still has. */
export const insertEntries = Effect.fn("dictionary.insertEntries")(function* (records: ReadonlyArray<EntryRecord>) {
  if (records.length === 0) return
  const db = yield* Database
  const ids = records.map((entry) => entry.id)
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // Forms and glosses are replaced wholesale. Senses are upserted by position, since
      // enrichment references them and would cascade away; only senses past an entry's
      // new count are deleted.
      yield* tx.delete(forms).where(inArray(forms.entryId, ids))
      yield* tx.delete(glosses).where(inArray(glosses.entryId, ids))
      const bySenseCount = new Map<number, Array<number>>()
      for (const entry of records) {
        const group = bySenseCount.get(entry.senses.length)
        if (group) group.push(entry.id)
        else bySenseCount.set(entry.senses.length, [entry.id])
      }
      for (const [count, group] of bySenseCount) {
        yield* tx.delete(senses).where(and(inArray(senses.entryId, group), gte(senses.position, count)))
      }
      yield* tx
        .insert(entries)
        .values(
          records.map((entry) => ({
            id: entry.id,
            headword: entry.headword,
            reading: entry.reading,
            common: entry.common,
            priority: entry.priority
          }))
        )
        .onConflictDoUpdate({
          target: entries.id,
          set: {
            headword: sql`excluded.headword`,
            reading: sql`excluded.reading`,
            common: sql`excluded.common`,
            priority: sql`excluded.priority`
          }
        })

      const formRows = records.flatMap((entry) => {
        const position = { kanji: 0, kana: 0 }
        return entry.forms.map((form) => ({
          entryId: entry.id,
          kind: form.kind,
          position: position[form.kind]++,
          text: form.text,
          common: form.common,
          tags: [...form.tags],
          priorities: [...form.priorities],
          restrictions: [...form.restrictions],
          noKanji: form.noKanji
        }))
      })
      for (const chunk of chunks(formRows, 2000)) yield* tx.insert(forms).values([...chunk])

      const senseRows = records.flatMap((entry) =>
        entry.senses.map((sense, position) => ({
          entryId: entry.id,
          position,
          pos: [...sense.pos],
          misc: [...sense.misc],
          fields: [...sense.fields],
          dialects: [...sense.dialects],
          info: [...sense.info],
          stagk: [...sense.stagk],
          stagr: [...sense.stagr],
          xrefs: [...sense.xrefs],
          antonyms: [...sense.antonyms]
        }))
      )
      for (const chunk of chunks(senseRows, 1500)) {
        yield* tx
          .insert(senses)
          .values([...chunk])
          .onConflictDoUpdate({
            target: [senses.entryId, senses.position],
            set: {
              pos: sql`excluded.pos`,
              misc: sql`excluded.misc`,
              fields: sql`excluded.fields`,
              dialects: sql`excluded.dialects`,
              info: sql`excluded.info`,
              stagk: sql`excluded.stagk`,
              stagr: sql`excluded.stagr`,
              xrefs: sql`excluded.xrefs`,
              antonyms: sql`excluded.antonyms`
            }
          })
      }

      const glossRows = records.flatMap((entry) =>
        entry.senses.flatMap((sense, senseIndex) =>
          sense.glosses.map((gloss, position) => ({
            entryId: entry.id,
            sense: senseIndex,
            position,
            text: gloss.text,
            type: gloss.type,
            norm: normalizeGloss(gloss.text)
          }))
        )
      )
      for (const chunk of chunks(glossRows, 3000)) yield* tx.insert(glosses).values([...chunk])
    })
  )
}, Effect.orDie)

const replaceTags = Effect.fn("dictionary.replaceTags")(function* (rows: ReadonlyArray<JMDictTag>) {
  const db = yield* Database
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(tags)
      for (const chunk of chunks(rows, 1000)) {
        yield* tx.insert(tags).values(chunk.map((tag) => ({ code: tag.code, label: tag.label })))
      }
    })
  )
}, Effect.orDie)

export interface ImportOptions {
  /** Path to JMdict_e.gz (or an uncompressed JMdict XML file). */
  readonly file: string
  /** Stop after this many entries, for quick local setups. */
  readonly limit?: number | undefined
  /** Only import entries JMDict marks as common (~22k words). */
  readonly commonOnly?: boolean | undefined
  readonly batchSize?: number | undefined
}

/**
 * Loads a JMdict release into the dictionary, updating entries in place: reseeding with
 * a newer release keeps the enrichment of every sense that still exists.
 */
export const importFile = Effect.fn("dictionary.importFile")(function* (options: ImportOptions) {
  const xml = yield* JMDict.read(options.file)

  const tagRows = parseTags(xml)
  yield* replaceTags(tagRows)
  yield* Effect.logInfo(`Loaded ${tagRows.length} JMDict tags`)

  const batchSize = options.batchSize ?? 500
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  let batch: Array<EntryRecord> = []
  let imported = 0

  for (const entry of parseEntries(xml)) {
    if (imported >= limit) break
    if (options.commonOnly && !entry.common) continue
    batch.push(entry)
    imported++
    if (batch.length >= batchSize) {
      yield* insertEntries(batch)
      batch = []
      if (imported % 20_000 < batchSize) yield* Effect.logInfo(`Imported ${imported} entries`)
    }
  }
  yield* insertEntries(batch)
  yield* Effect.logInfo(`Imported ${imported} entries`)
  return { entries: imported, tags: tagRows.length }
})
