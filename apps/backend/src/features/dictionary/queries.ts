import type { EntryRecord, Language } from "@kotori/contracts"
import {
  audio,
  type BaseCaution,
  type BaseLoanLink,
  type DraftCaution,
  englishDocument,
  entries,
  type EntryBase,
  type EntryEnrichment,
  type EntryId,
  entrySearch,
  isEnglishFormSearch,
  isEnglishGlossCjkSearch,
  isEnglishSpellingSearch,
  isGlossSearch,
  isJapaneseFormSearch,
  isJapaneseGlossDocSearch,
  MAX_CAUTIONS,
  type ReviewState,
  simpleDocument,
  tags
} from "@kotori/db"
import { cjkSearchTokens, englishPhraseVariants, nearBest, trigramFloor, trigramTargets } from "@kotori/language"
import {
  type AnyColumn,
  and,
  arrayContains,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  max,
  min,
  ne,
  notExists,
  sql
} from "drizzle-orm"
import { Effect } from "effect"
import { chunks } from "../../db/chunks.ts"
import type { DatabaseShape } from "../../db/Database.ts"
import type { EnrichmentKind } from "../enrichment/Enrichers.ts"
import { type ImportEntry, labelsOf, speaks, usagePatternsOf } from "./import/seedFacts.ts"
import { type SearchProjectionSource, syncEntrySearch } from "./searchProjection.ts"

export interface PriorityQuery {
  readonly limit: number
  readonly missing?: EnrichmentKind | undefined
  readonly commonOnly?: boolean | undefined
  /** Only entries with headwords in this language; both dictionaries when absent. */
  readonly language?: Language | undefined
}

/** Full stored entry document row. */
export type EntryDocument = typeof entries.$inferSelect

export interface InsertOptions {
  /**
   * The records are a seed import's, carrying everything their sources say: their seeded example
   * sentences and frequency signals replace the stored ones. Off, as when an alias re-inserts a
   * stored entry, those are left as they are.
   */
  readonly seeded?: boolean | undefined
  /** Initial review state for newly inserted entries (defaults to `approved`, or `unreviewed` for Ask Kotori drafts). */
  readonly reviewState?: ReviewState | undefined
}

/** Converts an `ImportEntry` into the JSONB `entries.base` document. */
const toEntryBase = (entry: ImportEntry, existing: EntryBase | undefined, seeded: boolean): EntryBase => ({
  headword: entry.headword,
  reading: entry.reading,
  forms: entry.forms.map((form) => ({
    kind: form.kind,
    text: form.text,
    common: form.common,
    tags: [...form.tags],
    priorities: [...form.priorities],
    restrictions: [...form.restrictions],
    noKanji: form.noKanji
  })),
  senses: entry.senses.map((sense, index) => {
    const prevSense = existing?.senses[index]
    const seededExamples = seeded
      ? (sense.examples ?? []).map((ex) => ({
          ja: ex.ja,
          furigana: ex.ja,
          en: ex.en,
          source: ex.source
        }))
      : (prevSense?.examples ?? [])
    return {
      glosses: sense.glosses.map((g) => ({ text: g.text, type: g.type })),
      pos: [...sense.pos],
      misc: [...sense.misc],
      fields: [...sense.fields],
      dialects: [...sense.dialects],
      info: [...sense.info],
      stagk: [...sense.stagk],
      stagr: [...sense.stagr],
      xrefs: [...sense.xrefs],
      antonyms: [...sense.antonyms],
      origins: [...sense.origins],
      wasei: sense.wasei,
      labels: labelsOf(sense).map((code) => ({ code, source: entry.source })),
      usagePatterns: usagePatternsOf(sense).map((text) => ({ text, source: entry.source })),
      ...(seededExamples.length > 0 ? { examples: seededExamples } : {})
    }
  }),
  frequency: seeded ? (speaks(entry.frequency) ? entry.frequency : null) : (existing?.frequency ?? null),
  loanLink: existing?.loanLink ?? null,
  ...(existing?.cautions !== undefined ? { cautions: existing.cautions } : {})
})

/** Converts a stored `EntryDocument` into the `EntryRecord` projection used by search & enrichers. */
export const documentToRecord = (doc: EntryDocument): EntryRecord => ({
  id: doc.id,
  language: doc.language,
  source: doc.source,
  common: doc.common,
  priority: doc.priority,
  headword: doc.base.headword,
  reading: doc.base.reading,
  forms: doc.base.forms,
  senses: doc.base.senses.map((sense) => ({
    glosses: sense.glosses,
    pos: sense.pos,
    misc: sense.misc,
    fields: sense.fields,
    dialects: sense.dialects,
    info: sense.info,
    stagk: sense.stagk,
    stagr: sense.stagr,
    xrefs: sense.xrefs,
    antonyms: sense.antonyms,
    origins: sense.origins,
    wasei: sense.wasei
  }))
})

/**
 * Inserts or replaces entries' `base` JSONB documents and rebuilds their `entry_search` projection
 * rows in the same transaction. `entries.enrichment` is never overwritten on re-import.
 */
export const insertEntries = Effect.fn("dictionary.insertEntries")(function* (
  db: DatabaseShape,
  records: ReadonlyArray<ImportEntry>,
  options: InsertOptions = {}
) {
  if (records.length === 0) return
  const seeded = options.seeded ?? false
  const ids = records.map((entry) => entry.id)

  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const existing = new Map<
        EntryId,
        {
          readonly base: EntryBase
          readonly reviewState: EntryDocument["reviewState"]
          readonly redirectTo: EntryId | null
        }
      >()
      for (const chunk of chunks(ids, 5000)) {
        const rows = yield* tx
          .select({
            id: entries.id,
            base: entries.base,
            reviewState: entries.reviewState,
            redirectTo: entries.redirectTo
          })
          .from(entries)
          .where(inArray(entries.id, [...chunk]))
        for (const row of rows) existing.set(row.id, row)
      }

      const now = new Date()
      const projections: Array<SearchProjectionSource> = []
      const values = records.map((entry) => {
        const prev = existing.get(entry.id)
        const base = toEntryBase(entry, prev?.base, seeded)
        const reviewState = prev?.reviewState ?? options.reviewState ?? "approved"
        const redirectTo = prev?.redirectTo ?? null
        projections.push({
          id: entry.id,
          language: entry.language,
          reviewState,
          redirectTo,
          common: entry.common,
          priority: entry.priority,
          base
        })
        return {
          id: entry.id,
          language: entry.language,
          source: entry.source,
          reviewState,
          redirectTo,
          common: entry.common,
          priority: entry.priority,
          base,
          updatedAt: now
        }
      })

      for (const chunk of chunks(values, 500)) {
        yield* tx
          .insert(entries)
          .values([...chunk])
          .onConflictDoUpdate({
            target: entries.id,
            set: {
              language: sql`excluded.language`,
              source: sql`excluded.source`,
              common: sql`excluded.common`,
              priority: sql`excluded.priority`,
              base: sql`excluded.base`,
              updatedAt: sql`excluded.updated_at`
            }
          })
      }

      yield* syncEntrySearch(tx, projections)
    })
  )
}, Effect.orDie)

/**
 * Links katakana loans to the English words they come from, as JMDict names them (`lsource`),
 * storing the resolved `BaseLoanLink` inside `entries.base.loanLink` on both the Japanese and
 * English entries. Re-run after either dictionary is imported; never touches `entries.enrichment`.
 */
export const linkLoans = Effect.fn("dictionary.linkLoans")(function* (db: DatabaseShape) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const jaRows = yield* tx
        .select({
          id: entries.id,
          priority: entries.priority,
          base: entries.base
        })
        .from(entries)
        .where(
          and(
            eq(entries.language, "ja"),
            eq(entries.source, "jmdict"),
            ne(entries.reviewState, "discarded"),
            isNull(entries.redirectTo)
          )
        )
        .orderBy(asc(entries.id))

      const enRows = yield* tx
        .select({
          id: entries.id,
          priority: entries.priority,
          base: entries.base
        })
        .from(entries)
        .where(
          and(
            eq(entries.language, "en"),
            like(entries.id, "en:%"),
            ne(entries.source, "kotori"),
            ne(entries.reviewState, "discarded"),
            isNull(entries.redirectTo)
          )
        )
        .orderBy(desc(entries.priority), asc(entries.id))

      const enByExact = new Map<string, (typeof enRows)[number]>()
      const enByLower = new Map<string, (typeof enRows)[number]>()
      for (const row of enRows) {
        if (!enByExact.has(row.base.headword)) enByExact.set(row.base.headword, row)
        const lower = row.base.headword.toLowerCase()
        if (!enByLower.has(lower)) enByLower.set(lower, row)
      }

      const jaLinks = new Map<EntryId, BaseLoanLink>()
      const enLinks = new Map<EntryId, { readonly link: BaseLoanLink; readonly jaPriority: number }>()

      for (const ja of jaRows) {
        let engWord: string | null = null
        for (const sense of ja.base.senses) {
          for (const origin of sense.origins) {
            if (origin.language === "eng" && origin.word !== null) {
              engWord = origin.word
              break
            }
          }
          if (engWord !== null) break
        }
        if (engWord === null) continue
        const en = enByExact.get(engWord) ?? enByLower.get(engWord.toLowerCase()) ?? null
        const link: BaseLoanLink = {
          katakana: ja.base.headword,
          katakanaEntryId: ja.id,
          english: engWord,
          englishEntryId: en?.id ?? null,
          meaning: null,
          source: "jmdict",
          meaningSource: null
        }
        jaLinks.set(ja.id, link)
        if (en !== null) {
          const prev = enLinks.get(en.id)
          if (prev === undefined || ja.priority > prev.jaPriority) {
            enLinks.set(en.id, { link, jaPriority: ja.priority })
          }
        }
      }

      // Update Japanese entries whose `base.loanLink` changed (only jmdict-sourced links).
      for (const ja of jaRows) {
        const next = jaLinks.get(ja.id) ?? null
        const prev = ja.base.loanLink ?? null
        if (JSON.stringify(prev) === JSON.stringify(next)) continue
        yield* tx
          .update(entries)
          .set({ base: { ...ja.base, loanLink: next } })
          .where(eq(entries.id, ja.id))
      }

      // Update English entries whose `base.loanLink` changed.
      for (const en of enRows) {
        const next = enLinks.get(en.id)?.link ?? null
        const prev = en.base.loanLink ?? null
        if (JSON.stringify(prev) === JSON.stringify(next)) continue
        yield* tx
          .update(entries)
          .set({ base: { ...en.base, loanLink: next } })
          .where(eq(entries.id, en.id))
      }
    })
  )
}, Effect.orDie)

/** Deletes entries and cascades to `entry_search`. */
export const deleteEntries = Effect.fn("dictionary.deleteEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  for (const chunk of chunks(ids, 5000)) yield* db.delete(entries).where(inArray(entries.id, [...chunk]))
}, Effect.orDie)

/**
 * Locks entry rows until the transaction ends (`FOR UPDATE`), in id order so two lockers can't
 * deadlock. Saving a note takes a KEY SHARE lock on its entry, so it waits until then.
 */
export const lockEntries = Effect.fn("dictionary.lockEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  for (const chunk of chunks(ids.toSorted(), 5000)) {
    yield* db
      .select({ id: entries.id })
      .from(entries)
      .where(inArray(entries.id, [...chunk]))
      .orderBy(entries.id)
      .for("update")
  }
}, Effect.orDie)

/** Adds tag names, replacing those of codes already known; codes the other dictionary uses are kept. */
export const saveTags = Effect.fn("dictionary.saveTags")(function* (
  db: DatabaseShape,
  rows: ReadonlyArray<{ readonly code: string; readonly name: string }>
) {
  const names = new Map<string, string>()
  for (const tag of rows) if (!names.has(tag.code)) names.set(tag.code, tag.name)
  for (const chunk of chunks([...names], 1000)) {
    yield* db
      .insert(tags)
      .values(chunk.map(([code, name]) => ({ code, name })))
      .onConflictDoUpdate({ target: tags.code, set: { name: sql`excluded.name` } })
  }
}, Effect.orDie)

export const tagNames = (db: DatabaseShape) =>
  db
    .select()
    .from(tags)
    .pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.code, row.name]))),
      Effect.orDie
    )

export const entryCount = (db: DatabaseShape) => db.$count(entries).pipe(Effect.orDie)

/** Entries whose headwords are in `language`. */
export const countOf = (db: DatabaseShape, language: Language) =>
  db.$count(entries, eq(entries.language, language)).pipe(Effect.orDie)

/** Every headword in one dictionary with its entry id. */
export const headwordIds = Effect.fn("dictionary.headwordIds")(function* (db: DatabaseShape, language: Language) {
  const rows = yield* db
    .select({ id: entries.id, headword: sql<string>`${entries.base}->>'headword'` })
    .from(entries)
    .where(eq(entries.language, language))
  return new Map(rows.map((row) => [row.headword, row.id]))
}, Effect.orDie)

/** External entry IDs for one source prefix (`jmdict:` or `en:`), so complete re-imports never touch `kotori:`. */
export const externalEntryIds = Effect.fn("dictionary.externalEntryIds")(function* (
  db: DatabaseShape,
  prefix: "jmdict:" | "en:"
) {
  const rows = yield* db
    .select({ id: entries.id })
    .from(entries)
    .where(like(entries.id, `${prefix}%`))
  return rows.map((row) => row.id)
}, Effect.orDie)

/** Loads full `EntryDocument` rows in the requested order. */
export const getEntryDocuments = Effect.fn("dictionary.getEntryDocuments")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  if (ids.length === 0) return []
  const rows = yield* db
    .select()
    .from(entries)
    .where(inArray(entries.id, [...ids]))
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id): Array<EntryDocument> => {
    const row = byId.get(id)
    return row === undefined ? [] : [row]
  })
}, Effect.orDie)

/** Loads `EntryRecord` projections in the requested order. */
export const getEntries = Effect.fn("dictionary.getEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  const docs = yield* getEntryDocuments(db, ids)
  return docs.map(documentToRecord)
}, Effect.orDie)

/** A list column as an array, empty where the row stores NULL. */
const listOf = <C extends AnyColumn>(column: C) => sql`coalesce(${column}, '{}')`.mapWith(column)

const formDocument = simpleDocument(entrySearch.text)
const glossDocument = englishDocument(entrySearch.text)

const simpleTsquery = (queries: ReadonlyArray<string>) =>
  sql`(${sql.join(
    queries.map((query) => sql`plainto_tsquery('simple', ${query})`),
    sql` || `
  )})`

const tsquery = (query: string) =>
  sql`CASE WHEN numnode(plainto_tsquery('english', ${query})) = 0 THEN plainto_tsquery('simple', ${query}) ELSE plainto_tsquery('english', ${query}) END`

const toTsquery = (queries: ReadonlyArray<string>) => sql`(${sql.join(queries.map(tsquery), sql` || `)})`

/** Entries in one dictionary with a form equal to one of `texts`; English ignores case. */
export const findForms = Effect.fn("dictionary.findForms")(function* (
  db: DatabaseShape,
  texts: ReadonlyArray<string>,
  language: Language = "ja"
) {
  if (texts.length === 0) return []
  const match = {
    entryId: entrySearch.entryId,
    text: entrySearch.text,
    kind: sql<NonNullable<typeof entrySearch.$inferSelect.formKind>>`${entrySearch.formKind}`,
    tags: listOf(entrySearch.tags)
  }
  if (language === "ja") {
    return yield* db
      .select(match)
      .from(entrySearch)
      .where(and(isJapaneseFormSearch(entrySearch.kind, entrySearch.language), inArray(entrySearch.text, [...texts])))
  }
  return yield* db
    .select(match)
    .from(entrySearch)
    .where(
      and(
        isEnglishFormSearch(entrySearch.kind, entrySearch.language),
        inArray(
          entrySearch.folded,
          texts.map((text) => text.toLowerCase())
        )
      )
    )
}, Effect.orDie)

/** Entry ids with a form starting with `prefix`, most common first; English ignores case and inflections. */
export const findFormPrefix = Effect.fn("dictionary.findFormPrefix")(function* (
  db: DatabaseShape,
  prefix: string,
  limit: number,
  language: Language = "ja"
) {
  const [col, start] = language === "ja" ? [entrySearch.text, prefix] : [entrySearch.folded, prefix.toLowerCase()]
  const predicate =
    language === "ja"
      ? and(isJapaneseFormSearch(entrySearch.kind, entrySearch.language), ne(entrySearch.formKind, "inflection"))
      : isEnglishSpellingSearch(entrySearch.kind, entrySearch.language, entrySearch.formKind)
  const rows = yield* db
    .select({ id: entrySearch.entryId })
    .from(entrySearch)
    .where(and(predicate, sql`${col} >= ${start} AND ${col} < ${start + "\u{10FFFF}"}`))
    .groupBy(entrySearch.entryId)
    .orderBy(
      desc(sql`bool_or(${entrySearch.common})`),
      desc(max(entrySearch.priority)),
      min(sql`length(${entrySearch.text})`)
    )
    .limit(limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

/** Stopword-preserving full-text search over English forms; a list of queries matches when any of them does. */
export const searchForms = Effect.fn("dictionary.searchForms")(function* (
  db: DatabaseShape,
  queries: ReadonlyArray<string>,
  limit: number
) {
  if (queries.length === 0) return []
  const query = simpleTsquery(queries)
  const rank = sql<number>`-ts_rank_cd(${formDocument}, ${query})`
  return yield* db
    .select({
      entryId: entrySearch.entryId,
      text: entrySearch.text,
      kind: sql<NonNullable<typeof entrySearch.$inferSelect.formKind>>`${entrySearch.formKind}`,
      tags: listOf(entrySearch.tags),
      rank: rank.mapWith(Number)
    })
    .from(entrySearch)
    .where(
      and(
        isEnglishSpellingSearch(entrySearch.kind, entrySearch.language, entrySearch.formKind),
        sql`${formDocument} @@ ${query}`
      )
    )
    .orderBy(rank, desc(entrySearch.common), desc(entrySearch.priority), sql`length(${entrySearch.text})`)
    .limit(limit)
}, Effect.orDie)

const trigramMatch = (column: AnyColumn, query: string) => {
  const targets = trigramTargets(query)
  if (targets.length === 0) return null
  return {
    condition: sql`(${sql.join(
      targets.map((target) => sql`${column} % ${target}`),
      sql` OR `
    )})`,
    similarity: sql<number>`greatest(${sql.join(
      targets.map((target) => sql`similarity(${column}, ${target})`),
      sql`, `
    )})`
  }
}

/** English forms spelled like `query`, for typos and phrases with a word changed: "umbrela" finds umbrella. */
export const searchFormsFuzzy = Effect.fn("dictionary.searchFormsFuzzy")(function* (
  db: DatabaseShape,
  query: string,
  limit: number
) {
  const match = trigramMatch(entrySearch.text, query)
  if (match === null) return []
  const rows = yield* db
    .select({
      entryId: entrySearch.entryId,
      text: entrySearch.text,
      kind: sql<NonNullable<typeof entrySearch.$inferSelect.formKind>>`${entrySearch.formKind}`,
      tags: listOf(entrySearch.tags),
      similarity: match.similarity.mapWith(Number)
    })
    .from(entrySearch)
    .where(and(isEnglishSpellingSearch(entrySearch.kind, entrySearch.language, entrySearch.formKind), match.condition))
    .orderBy(
      desc(match.similarity),
      desc(entrySearch.common),
      desc(entrySearch.priority),
      sql`length(${entrySearch.text})`
    )
    .limit(limit)
  return nearBest(rows, trigramFloor(query))
}, Effect.orDie)

const glossMatch = {
  entryId: entrySearch.entryId,
  sense: sql<number>`${entrySearch.sense}`.mapWith(Number),
  position: sql<number>`${entrySearch.position}`.mapWith(Number),
  text: entrySearch.text,
  glossCount: sql<number>`${entrySearch.glossCount}`.mapWith(Number),
  misc: listOf(entrySearch.misc)
}

/** Full-text search over the English glosses of Japanese words; a list of queries matches when any of them does. */
export const searchGlosses = Effect.fn("dictionary.searchGlosses")(function* (
  db: DatabaseShape,
  queries: ReadonlyArray<string>,
  limit: number
) {
  if (queries.length === 0) return []
  const query = toTsquery(queries)
  const rank = sql<number>`-ts_rank_cd(${glossDocument}, ${query})`
  return yield* db
    .select({ ...glossMatch, rank: rank.mapWith(Number) })
    .from(entrySearch)
    .where(and(isJapaneseGlossDocSearch(entrySearch.kind, entrySearch.language), sql`${glossDocument} @@ ${query}`))
    .orderBy(rank)
    .limit(limit)
}, Effect.orDie)

/** English glosses of Japanese words spelled like `query`, for typos and phrases with a word changed. */
export const searchGlossesFuzzy = Effect.fn("dictionary.searchGlossesFuzzy")(function* (
  db: DatabaseShape,
  query: string,
  limit: number
) {
  const match = trigramMatch(entrySearch.norm, query)
  if (match === null) return []
  const rows = yield* db
    .select({
      ...glossMatch,
      rank: sql<number>`-10 * ${match.similarity}`.mapWith(Number),
      similarity: match.similarity.mapWith(Number)
    })
    .from(entrySearch)
    .where(and(isGlossSearch(entrySearch.kind), eq(entrySearch.language, "ja"), match.condition))
    .orderBy(desc(match.similarity), desc(entrySearch.common), desc(entrySearch.priority))
    .limit(limit)
  return nearBest(rows)
}, Effect.orDie)

const glossesWithNorm = (db: DatabaseShape, norms: ReadonlyArray<string>, language: Language, limit: number) =>
  db
    .select({ ...glossMatch, rank: sql<number>`0`.mapWith(Number) })
    .from(entrySearch)
    .where(
      and(isGlossSearch(entrySearch.kind), eq(entrySearch.language, language), inArray(entrySearch.norm, [...norms]))
    )
    .orderBy(desc(entrySearch.common), desc(entrySearch.priority))
    .limit(limit)

/** English glosses of Japanese words matching `query` or its pronoun/placeholder variants (`englishPhraseVariants`). */
export const findGlossesExact = Effect.fn("dictionary.findGlossesExact")(function* (
  db: DatabaseShape,
  query: string,
  limit: number
) {
  const norms = englishPhraseVariants(query)
  if (norms.length === 0) return []
  return yield* glossesWithNorm(db, norms, "ja", limit)
}, Effect.orDie)

/** Japanese glosses of English words whose normalised text is one of `norms` (see `normalizeJapaneseGloss`). */
export const findJapaneseGlosses = Effect.fn("dictionary.findJapaneseGlosses")(function* (
  db: DatabaseShape,
  norms: ReadonlyArray<string>,
  limit: number
) {
  const wanted = norms.filter((norm) => norm.length > 0)
  if (wanted.length === 0) return []
  return yield* glossesWithNorm(db, wanted, "en", limit)
}, Effect.orDie)

/**
 * Japanese glosses of English words containing `text`, using the GIN index on
 * `entry_search.cjk_tokens` (overlapping CJK bigrams and kanji unigrams) with a `LIKE`
 * recheck for contiguous substring order.
 */
export const searchJapaneseGlosses = Effect.fn("dictionary.searchJapaneseGlosses")(function* (
  db: DatabaseShape,
  text: string,
  limit: number
) {
  if (text.length === 0) return []
  const tokens = cjkSearchTokens(text)
  const pattern = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  return yield* db
    .select({ ...glossMatch, rank: sql<number>`-1.0 / length(${entrySearch.norm})`.mapWith(Number) })
    .from(entrySearch)
    .where(
      and(
        isEnglishGlossCjkSearch(entrySearch.kind, entrySearch.language),
        tokens.length > 0 ? arrayContains(entrySearch.cjkTokens, tokens) : undefined,
        sql`${entrySearch.norm} LIKE ${pattern}`
      )
    )
    .orderBy(desc(entrySearch.common), desc(entrySearch.priority), sql`length(${entrySearch.norm})`)
    .limit(limit)
}, Effect.orDie)

/** Commonness, frequency, and review state of entries, for ranking without loading full documents. */
export const entryRanks = Effect.fn("dictionary.entryRanks")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  if (ids.length === 0) return new Map<EntryId, { common: boolean; priority: number; reviewState: ReviewState }>()
  const rows = yield* db
    .select({
      id: entries.id,
      common: entries.common,
      priority: entries.priority,
      reviewState: entries.reviewState
    })
    .from(entries)
    .where(inArray(entries.id, [...ids]))
  return new Map(
    rows.map((row) => [row.id, { common: row.common, priority: row.priority, reviewState: row.reviewState }])
  )
}, Effect.orDie)

const missing = (db: DatabaseShape, kind: EnrichmentKind) => {
  switch (kind) {
    case "examples":
      return sql`coalesce(jsonb_array_length(${entries.enrichment}->'examples'), 0) = 0`
    case "audio":
      return notExists(
        db
          .select()
          .from(audio)
          .where(
            and(
              eq(audio.language, entries.language),
              eq(
                audio.text,
                sql`CASE WHEN ${entries.language} = 'ja' THEN ${entries.base}->>'reading' ELSE ${entries.base}->>'headword' END`
              )
            )
          )
      )
  }
}

/** Entry ids in priority order, optionally only those still missing some enrichment. */
export const entriesByPriority = Effect.fn("dictionary.entriesByPriority")(function* (
  db: DatabaseShape,
  query: PriorityQuery
) {
  const rows = yield* db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        ne(entries.reviewState, "discarded"),
        isNull(entries.redirectTo),
        query.language ? eq(entries.language, query.language) : undefined,
        query.commonOnly ? eq(entries.common, true) : undefined,
        query.missing ? missing(db, query.missing) : undefined
      )
    )
    .orderBy(desc(entries.priority), asc(entries.id))
    .limit(query.limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

export type FormMatch = Effect.Success<ReturnType<typeof findForms>>[number]
export type GlossMatch = Effect.Success<ReturnType<typeof searchGlosses>>[number]

const resolveWord = Effect.fn("dictionary.resolveWord")(function* (
  db: DatabaseShape,
  text: string,
  language: Language
) {
  const matches = (yield* findForms(db, [text], language)).filter((form) => form.kind !== "inflection")
  const ids = [...new Set(matches.map((form) => form.entryId))]
  return ids.length === 1 ? ids[0]! : null
})

/**
 * Replaces Kotori's cautions on an entry with `drafted`, in order, each linked to the word it
 * names where exactly one matches. For `source = 'kotori'` entries, cautions are stored in
 * `base.cautions`; for external entries, they are stored in `enrichment.cautions`.
 */
export const saveKotoriCautions = Effect.fn("dictionary.saveKotoriCautions")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  language: Language,
  drafted: ReadonlyArray<DraftCaution>
) {
  const resolved: Array<BaseCaution> = []
  for (const caution of drafted.slice(0, MAX_CAUTIONS)) {
    resolved.push({
      sense: caution.sense,
      kind: caution.kind,
      text: caution.text,
      aboutEntryId: caution.about === null ? null : yield* resolveWord(db, caution.about, language),
      source: "kotori"
    })
  }
  const [doc] = yield* getEntryDocuments(db, [entryId])
  if (doc === undefined) return
  if (doc.source === "kotori") {
    yield* db
      .update(entries)
      .set({ base: { ...doc.base, cautions: resolved }, updatedAt: new Date() })
      .where(eq(entries.id, entryId))
  } else {
    const nextEnrichment: EntryEnrichment = { ...doc.enrichment, cautions: resolved }
    yield* db.update(entries).set({ enrichment: nextEnrichment, updatedAt: new Date() }).where(eq(entries.id, entryId))
  }
}, Effect.orDie)
