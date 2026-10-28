import { Database } from "@kotori/db"
import { entries, forms, glosses, senses, tags } from "@kotori/db/schema"
import type { EntryRecord } from "@kotori/jmdict"
import { asc, inArray } from "drizzle-orm"
import { Effect } from "effect"

// The dictionary reads that several use cases share: search, entry pages, coaching and
// enrichment all load entries, look up forms and rank by frequency.

/**
 * Normalises an English gloss or query for exact matching:
 * "to eat (a meal)" -> "eat", "The Sun" -> "sun".
 */
export const normalizeGloss = (text: string) =>
  text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the) /, "")

/** The first few meanings of an entry, topped up from its second sense when the first has fewer. */
export const firstGlosses = (entry: EntryRecord, count: number) => {
  const meanings = entry.senses[0]?.glosses.slice(0, count).map((gloss) => gloss.text) ?? []
  const second = entry.senses[1]?.glosses[0]?.text
  return meanings.length < count && second !== undefined ? [...meanings, second] : meanings
}

/** Entries in the order of `ids`, each with its forms, senses and glosses, in the shape JMDict's parser produces. */
export const getEntries = Effect.fn("dictionary.getEntries")(function* (ids: ReadonlyArray<number>) {
  if (ids.length === 0) return []
  const db = yield* Database
  const [entryRows, formRows, senseRows, glossRows] = yield* Effect.all([
    db.select().from(entries).where(inArray(entries.id, ids)),
    db.select().from(forms).where(inArray(forms.entryId, ids)).orderBy(forms.entryId, asc(forms.kind), forms.position),
    db.select().from(senses).where(inArray(senses.entryId, ids)).orderBy(senses.entryId, senses.position),
    db
      .select({ entryId: glosses.entryId, sense: glosses.sense, text: glosses.text, type: glosses.type })
      .from(glosses)
      .where(inArray(glosses.entryId, ids))
      .orderBy(glosses.entryId, glosses.sense, glosses.position)
  ])
  const byId = new Map(entryRows.map((entry) => [entry.id, entry]))
  return ids.flatMap((id): Array<EntryRecord> => {
    const entry = byId.get(id)
    if (entry === undefined) return []
    return [
      {
        ...entry,
        forms: formRows.filter((form) => form.entryId === id).map(({ entryId: _, position: __, ...form }) => form),
        senses: senseRows
          .filter((sense) => sense.entryId === id)
          .map(({ entryId: _, position, ...sense }) => ({
            ...sense,
            glosses: glossRows
              .filter((gloss) => gloss.entryId === id && gloss.sense === position)
              .map((gloss) => ({ text: gloss.text, type: gloss.type }))
          }))
      }
    ]
  })
}, Effect.orDie)

/** Forms exactly equal to one of `texts`, with the entries they belong to. */
export const findForms = Effect.fn("dictionary.findForms")(function* (texts: ReadonlyArray<string>) {
  if (texts.length === 0) return []
  const db = yield* Database
  return yield* db
    .select({ entryId: forms.entryId, text: forms.text, kind: forms.kind })
    .from(forms)
    .where(inArray(forms.text, texts))
}, Effect.orDie)

/** Commonness and frequency of entries, for ranking without loading them. */
export const ranks = Effect.fn("dictionary.ranks")(function* (ids: ReadonlyArray<number>) {
  if (ids.length === 0) return new Map<number, { readonly common: boolean; readonly priority: number }>()
  const db = yield* Database
  const rows = yield* db
    .select({ id: entries.id, common: entries.common, priority: entries.priority })
    .from(entries)
    .where(inArray(entries.id, ids))
  return new Map(rows.map((row) => [row.id, { common: row.common, priority: row.priority }]))
}, Effect.orDie)

/** JMDict's tag codes (parts of speech, usage, fields) and their labels. */
export const tagLabels = Effect.gen(function* () {
  const rows = yield* (yield* Database).select().from(tags)
  return new Map(rows.map((row) => [row.code, row.label]))
}).pipe(Effect.orDie, Effect.withSpan("dictionary.tagLabels"))

/** How many entries the dictionary has. */
export const count = Effect.flatMap(Database, (db) => db.$count(entries)).pipe(Effect.orDie)
