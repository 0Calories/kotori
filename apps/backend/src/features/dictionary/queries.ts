import type { EntryRecord, Language } from "@kotori/contracts"
import {
  entries,
  type EntryId,
  entryAudio,
  examples,
  forms,
  glosses,
  jobKind,
  type NoteId,
  notes,
  senseNotes,
  senseNuance,
  senses,
  similarWords,
  tags
} from "@kotori/db"
import {
  englishPhraseVariants,
  KATAKANA_WORD,
  type LoanCandidate,
  normalizeEnglishPhrase,
  normalizeGloss,
  normalizeJapaneseGloss
} from "@kotori/language"
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  max,
  min,
  ne,
  notExists,
  sql
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { chunks } from "../../db/chunks.ts"
import type { DatabaseShape } from "../../db/Database.ts"
import { matchSenses } from "./import/matchSenses.ts"

/** Enrichment an entry can be missing, used to find work for the worker. The English side is judged on view, never backfilled. */
export type EnrichmentKind = Exclude<(typeof jobKind.enumValues)[number], "english">

export interface PriorityQuery {
  readonly limit: number
  readonly missing?: EnrichmentKind | undefined
  readonly commonOnly?: boolean | undefined
  /** Only entries with headwords in this language; both dictionaries when absent. */
  readonly language?: Language | undefined
}

/** How many glosses the sense of a gloss row has. */
const glossCount = sql<number>`(
  SELECT count(*) FROM ${glosses} AS g2
  WHERE g2.entry_id = ${glosses.entryId} AND g2.sense = ${glosses.sense}
)`.mapWith(Number)

type Tx = Parameters<Parameters<DatabaseShape["transaction"]>[0]>[0]

/**
 * Where each entry's stored senses go in `records`: per entry, each stored sense's new
 * position, or null where it is gone. Entries whose senses all stay put are left out, which
 * is every entry on a first import and nearly every one on a re-import of unchanged sources.
 */
const sensesMoved = Effect.fnUntraced(function* (tx: Tx, records: ReadonlyArray<EntryRecord>) {
  const stored = new Map<EntryId, Array<Array<string>>>()
  for (const chunk of chunks(
    records.map((entry) => entry.id),
    5000
  )) {
    const positions = yield* tx
      .select({ entryId: senses.entryId, position: senses.position })
      .from(senses)
      .where(inArray(senses.entryId, [...chunk]))
    for (const row of positions) {
      const list = stored.get(row.entryId) ?? []
      list[row.position] = []
      stored.set(row.entryId, list)
    }
    const rows = yield* tx
      .select({ entryId: glosses.entryId, sense: glosses.sense, text: glosses.text })
      .from(glosses)
      .where(inArray(glosses.entryId, [...chunk]))
      .orderBy(asc(glosses.entryId), asc(glosses.sense), asc(glosses.position))
    for (const row of rows) stored.get(row.entryId)?.[row.sense]?.push(row.text)
  }
  const moves = new Map<EntryId, ReadonlyArray<number | null>>()
  for (const entry of records) {
    const before = stored.get(entry.id)
    if (before === undefined) continue
    const dense = Array.from({ length: before.length }, (_, index) => before[index] ?? [])
    const match = matchSenses(
      dense,
      entry.senses.map((sense) => sense.glosses.map((gloss) => gloss.text))
    )
    if (dense.length !== entry.senses.length || match.some((to, from) => to !== from)) moves.set(entry.id, match)
  }
  return moves
})

/**
 * Takes out the rows keyed by sense of entries whose senses move, until the senses are in
 * place: judgments, notes and similar words are held and deleted; example sentences and
 * saved words are only listed, as they are moved in place (keeping their ids and audio).
 */
const takeSenseRows = Effect.fnUntraced(function* (tx: Tx, ids: ReadonlyArray<EntryId>) {
  const held = {
    nuance: yield* tx
      .select()
      .from(senseNuance)
      .where(inArray(senseNuance.entryId, [...ids])),
    notes: yield* tx
      .select()
      .from(senseNotes)
      .where(inArray(senseNotes.entryId, [...ids])),
    similar: yield* tx
      .select()
      .from(similarWords)
      .where(inArray(similarWords.entryId, [...ids])),
    sentences: yield* tx
      .select({ id: examples.id, entryId: examples.entryId, sense: examples.sense })
      .from(examples)
      .where(inArray(examples.entryId, [...ids])),
    saved: yield* tx
      .select({ id: notes.id, entryId: notes.entryId, sense: notes.sense })
      .from(notes)
      .where(and(inArray(notes.entryId, [...ids]), isNotNull(notes.sense)))
  }
  yield* tx.delete(senseNuance).where(inArray(senseNuance.entryId, [...ids]))
  yield* tx.delete(senseNotes).where(inArray(senseNotes.entryId, [...ids]))
  yield* tx.delete(similarWords).where(inArray(similarWords.entryId, [...ids]))
  return held
})

/** Puts the taken rows back with their senses; a sense that is gone takes its rows with it. */
const moveSenseRows = Effect.fnUntraced(function* (
  tx: Tx,
  moves: ReadonlyMap<EntryId, ReadonlyArray<number | null>>,
  held: Effect.Success<ReturnType<typeof takeSenseRows>>
) {
  const to = (entryId: EntryId | null, sense: number | null) =>
    entryId === null || sense === null ? null : (moves.get(entryId)?.[sense] ?? null)
  const follow = <R extends { readonly entryId: EntryId; readonly sense: number }>(rows: ReadonlyArray<R>) =>
    rows.flatMap((row) => {
      const sense = to(row.entryId, row.sense)
      return sense === null ? [] : [{ ...row, sense }]
    })
  for (const chunk of chunks(follow(held.nuance), 1000)) yield* tx.insert(senseNuance).values([...chunk])
  for (const chunk of chunks(follow(held.notes), 1000)) yield* tx.insert(senseNotes).values([...chunk])
  for (const chunk of chunks(follow(held.similar), 1000)) yield* tx.insert(similarWords).values([...chunk])

  // Sentences move by id, so a swap of two senses can't carry either set twice.
  const sentences = new Map<number, Array<number>>()
  const unheard: Array<number> = []
  for (const sentence of held.sentences) {
    const sense = to(sentence.entryId, sentence.sense)
    if (sense === null) unheard.push(sentence.id)
    else if (sense !== sentence.sense) sentences.set(sense, [...(sentences.get(sense) ?? []), sentence.id])
  }
  for (const [sense, ids] of sentences) {
    for (const chunk of chunks(ids, 5000))
      yield* tx
        .update(examples)
        .set({ sense })
        .where(inArray(examples.id, [...chunk]))
  }
  for (const chunk of chunks(unheard, 5000)) yield* tx.delete(examples).where(inArray(examples.id, [...chunk]))

  // Saved words follow too, in the column and in the card content the entry page reads.
  // (user, entry, sense) is unique, so they pass through negative positions: a swap made
  // in one step would collide halfway. A word whose sense is gone keeps its cards and
  // loses only its place on the entry page.
  const saved = new Map<number, Array<NoteId>>()
  const orphaned: Array<NoteId> = []
  for (const note of held.saved) {
    const sense = to(note.entryId, note.sense)
    if (sense === null) orphaned.push(note.id)
    else saved.set(sense, [...(saved.get(sense) ?? []), note.id])
  }
  for (const [sense, ids] of saved) {
    yield* tx
      .update(notes)
      .set({
        sense: -sense - 1,
        content: sql`jsonb_set(${notes.content}, '{senseIndex}', to_jsonb(${sense}::integer))`
      })
      .where(inArray(notes.id, ids))
  }
  if (saved.size > 0) {
    yield* tx
      .update(notes)
      .set({ sense: sql`-${notes.sense} - 1` })
      .where(and(inArray(notes.entryId, [...moves.keys()]), lt(notes.sense, 0)))
  }
  if (orphaned.length > 0) {
    yield* tx
      .update(notes)
      .set({ sense: null, content: sql`jsonb_set(${notes.content}, '{senseIndex}', '-1'::jsonb)` })
      .where(inArray(notes.id, orphaned))
  }
})

/** Inserts or replaces entries and their forms, senses and glosses. Enrichment survives for every sense the entry still has. */
export const insertEntries = Effect.fn("dictionary.insertEntries")(function* (
  db: DatabaseShape,
  records: ReadonlyArray<EntryRecord>
) {
  if (records.length === 0) return
  const ids = records.map((entry) => entry.id)
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // Forms and glosses are replaced wholesale. Senses are upserted by position, since
      // enrichment references them and would cascade away; only senses past an entry's
      // new count are deleted. Where a re-import moves senses (or drops one), enrichment
      // keyed by position follows its sense, matched by glosses (`matchSenses`), and
      // what belonged to a sense that is gone goes with it.
      const moves = yield* sensesMoved(tx, records)
      const moved = [...moves.keys()]
      const keyed = moved.length === 0 ? null : yield* takeSenseRows(tx, moved)
      yield* tx.delete(forms).where(inArray(forms.entryId, ids))
      yield* tx.delete(glosses).where(inArray(glosses.entryId, ids))
      yield* tx
        .insert(entries)
        .values(
          records.map((entry) => ({
            id: entry.id,
            language: entry.language,
            headword: entry.headword,
            reading: entry.reading,
            common: entry.common,
            priority: entry.priority
          }))
        )
        .onConflictDoUpdate({
          target: entries.id,
          set: {
            language: sql`excluded.language`,
            headword: sql`excluded.headword`,
            reading: sql`excluded.reading`,
            common: sql`excluded.common`,
            priority: sql`excluded.priority`
          }
        })

      const formRows = records.flatMap((entry) => {
        const position = { kanji: 0, kana: 0, spelling: 0, inflection: 0 }
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
          antonyms: [...sense.antonyms],
          sources: [...sense.sources],
          wasei: sense.wasei
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
              antonyms: sql`excluded.antonyms`,
              sources: sql`excluded.sources`,
              wasei: sql`excluded.wasei`
            }
          })
      }
      // Every new position exists now, so rows can move before the surplus senses go.
      if (keyed !== null) yield* moveSenseRows(tx, moves, keyed)
      const bySenseCount = new Map<number, Array<EntryId>>()
      for (const entry of records) {
        const group = bySenseCount.get(entry.senses.length)
        if (group) group.push(entry.id)
        else bySenseCount.set(entry.senses.length, [entry.id])
      }
      for (const [count, group] of bySenseCount) {
        yield* tx.delete(senses).where(and(inArray(senses.entryId, group), gte(senses.position, count)))
      }

      const glossRows = records.flatMap((entry) =>
        entry.senses.flatMap((sense, senseIndex) =>
          sense.glosses.map((gloss, position) => ({
            entryId: entry.id,
            sense: senseIndex,
            position,
            text: gloss.text,
            type: gloss.type,
            // Glosses are in the other language from the headword.
            norm: entry.language === "ja" ? normalizeGloss(gloss.text) : normalizeJapaneseGloss(gloss.text)
          }))
        )
      )
      for (const chunk of chunks(glossRows, 3000)) yield* tx.insert(glosses).values([...chunk])
    })
  )
}, Effect.orDie)

/** Deletes entries and everything hanging off them: forms, senses, enrichment and jobs. */
export const deleteEntries = Effect.fn("dictionary.deleteEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  for (const chunk of chunks(ids, 5000)) yield* db.delete(entries).where(inArray(entries.id, [...chunk]))
}, Effect.orDie)

/** Adds tag labels, replacing those of codes already known; codes the other dictionary uses are kept. */
export const saveTags = Effect.fn("dictionary.saveTags")(function* (
  db: DatabaseShape,
  rows: ReadonlyArray<{ readonly code: string; readonly label: string }>
) {
  // One row per code, or the upsert would touch a row twice; the first label wins.
  const labels = new Map<string, string>()
  for (const tag of rows) if (!labels.has(tag.code)) labels.set(tag.code, tag.label)
  for (const chunk of chunks([...labels], 1000)) {
    yield* db
      .insert(tags)
      .values(chunk.map(([code, label]) => ({ code, label })))
      .onConflictDoUpdate({ target: tags.code, set: { label: sql`excluded.label` } })
  }
}, Effect.orDie)

export const tagLabels = (db: DatabaseShape) =>
  db
    .select()
    .from(tags)
    .pipe(
      Effect.map((rows) => new Map(rows.map((row) => [row.code, row.label]))),
      Effect.orDie
    )

export const entryCount = (db: DatabaseShape) => db.$count(entries).pipe(Effect.orDie)

/** Entries whose headwords are in `language`. */
export const countOf = (db: DatabaseShape, language: Language) =>
  db.$count(entries, eq(entries.language, language)).pipe(Effect.orDie)

/** Every headword in one dictionary with its entry id, so a re-import keeps ids stable. */
export const headwordIds = Effect.fn("dictionary.headwordIds")(function* (db: DatabaseShape, language: Language) {
  const rows = yield* db
    .select({ id: entries.id, headword: entries.headword })
    .from(entries)
    .where(eq(entries.language, language))
  return new Map(rows.map((row) => [row.headword, row.id]))
}, Effect.orDie)

export const getEntries = Effect.fn("dictionary.getEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  if (ids.length === 0) return []
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
        forms: formRows
          .filter((form) => form.entryId === id)
          .map(({ entryId: _, position: __, document: ___, ...form }) => form),
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

/** `lower(text)`, which `forms_folded` indexes, so English matches whatever the case. */
const folded = sql<string>`lower(${forms.text})`

/** Matches when any of `queries` does, each requiring all of its words (`plainto_tsquery`). */
const toTsquery = (queries: ReadonlyArray<string>) =>
  sql`(${sql.join(
    queries.map((query) => sql`plainto_tsquery('english', ${query})`),
    sql` || `
  )})`

/** Entries in one dictionary with a form equal to one of `texts`; English ignores case. */
export const findForms = Effect.fn("dictionary.findForms")(function* (
  db: DatabaseShape,
  texts: ReadonlyArray<string>,
  language: Language = "ja"
) {
  if (texts.length === 0) return []
  return yield* db
    .select({ entryId: forms.entryId, text: forms.text, kind: forms.kind, tags: forms.tags })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(
      and(
        eq(entries.language, language),
        language === "ja"
          ? inArray(forms.text, texts)
          : inArray(
              folded,
              texts.map((text) => text.toLowerCase())
            )
      )
    )
}, Effect.orDie)

// A range scan on bytewise-collated text, so the index serves it.

/** Entry ids with a form starting with `prefix`, most common first; English ignores case and inflections. */
export const findFormPrefix = Effect.fn("dictionary.findFormPrefix")(function* (
  db: DatabaseShape,
  prefix: string,
  limit: number,
  language: Language = "ja"
) {
  const [text, start] = language === "ja" ? [forms.text, prefix] : [folded, prefix.toLowerCase()]
  const rows = yield* db
    .select({ id: forms.entryId })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(
      and(
        eq(entries.language, language),
        ne(forms.kind, "inflection"),
        sql`${text} >= ${start} AND ${text} < ${start + "\u{10FFFF}"}`
      )
    )
    .groupBy(forms.entryId)
    .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)), min(sql`length(${forms.text})`))
    .limit(limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

/** Full-text search over English forms; a list of queries matches when any of them does. */
export const searchForms = Effect.fn("dictionary.searchForms")(function* (
  db: DatabaseShape,
  queries: ReadonlyArray<string>,
  limit: number
) {
  if (queries.length === 0) return []
  const tsquery = toTsquery(queries)
  const rank = sql<number>`-ts_rank_cd(${forms.document}, ${tsquery})`
  return yield* db
    .select({
      entryId: forms.entryId,
      text: forms.text,
      kind: forms.kind,
      tags: forms.tags,
      rank: rank.mapWith(Number)
    })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(and(eq(entries.language, "en"), ne(forms.kind, "inflection"), sql`${forms.document} @@ ${tsquery}`))
    .orderBy(rank, desc(entries.common), desc(entries.priority), sql`length(${forms.text})`)
    .limit(limit)
}, Effect.orDie)

/** Fewer letters than this and a typo is as near to noise as to the word meant: "cta" for "cat". */
const MIN_TRIGRAM_LENGTH = 4

/** How far below the best match a trigram match may fall: "umbrela" finds umbrella (0.7), not umbra (0.4). */
const TRIGRAM_SPREAD = 0.15

const MIN_PHRASE_SIMILARITY = 0.45

/**
 * Trigram similarity of `column` to an English query as typed and with its pronouns and articles
 * stripped (`normalizeEnglishPhrase`); `condition` is pg_trgm's `%`, at its 0.3 threshold.
 * Null when the query is too short to compare.
 */
const trigramMatch = (column: AnyColumn, query: string) => {
  const targets = [...new Set([normalizeGloss(query), normalizeEnglishPhrase(query)])].filter(
    (target) => target.length >= MIN_TRIGRAM_LENGTH
  )
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

/** The matches within `TRIGRAM_SPREAD` of the best, which comes first. */
const nearBest = <A extends { readonly similarity: number }>(matches: ReadonlyArray<A>, minSimilarity = 0) => {
  const floor = Math.max((matches[0]?.similarity ?? 0) - TRIGRAM_SPREAD, minSimilarity)
  return matches.filter((match) => match.similarity >= floor)
}

/** English forms spelled like `query`, for typos and phrases with a word changed: "umbrela" finds umbrella. */
export const searchFormsFuzzy = Effect.fn("dictionary.searchFormsFuzzy")(function* (
  db: DatabaseShape,
  query: string,
  limit: number
) {
  const match = trigramMatch(forms.text, query)
  if (match === null) return []
  const rows = yield* db
    .select({
      entryId: forms.entryId,
      text: forms.text,
      kind: forms.kind,
      tags: forms.tags,
      similarity: match.similarity.mapWith(Number)
    })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(and(eq(entries.language, "en"), ne(forms.kind, "inflection"), match.condition))
    .orderBy(desc(match.similarity), desc(entries.common), desc(entries.priority), sql`length(${forms.text})`)
    .limit(limit)
  return nearBest(rows, /\s/.test(query.trim()) ? MIN_PHRASE_SIMILARITY : 0)
}, Effect.orDie)

const glossMatch = {
  entryId: glosses.entryId,
  sense: glosses.sense,
  position: glosses.position,
  text: glosses.text,
  glossCount,
  misc: senses.misc
}

// `rank` is negated ts_rank_cd so it keeps the old FTS5 bm25 shape: ascending, more negative = better.
// Cover density is about 0.1 divided by how far apart the query's words sit, so "thin ice" ranks
// "skate on thin ice" (0.1) above "ice cream in thin slices" (0.025).

/** Full-text search over the English glosses of Japanese words; a list of queries matches when any of them does. */
export const searchGlosses = Effect.fn("dictionary.searchGlosses")(function* (
  db: DatabaseShape,
  queries: ReadonlyArray<string>,
  limit: number
) {
  if (queries.length === 0) return []
  const tsquery = toTsquery(queries)
  return yield* db
    .select({ ...glossMatch, rank: sql<number>`-ts_rank_cd(${glosses.document}, ${tsquery})`.mapWith(Number) })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(and(eq(entries.language, "ja"), sql`${glosses.document} @@ ${tsquery}`))
    .orderBy(sql`-ts_rank_cd(${glosses.document}, ${tsquery})`)
    .limit(limit)
}, Effect.orDie)

/** English glosses of Japanese words spelled like `query`, for typos and phrases with a word changed. */
export const searchGlossesFuzzy = Effect.fn("dictionary.searchGlossesFuzzy")(function* (
  db: DatabaseShape,
  query: string,
  limit: number
) {
  const match = trigramMatch(glosses.norm, query)
  if (match === null) return []
  const rows = yield* db
    .select({
      ...glossMatch,
      // Shaped like `searchGlosses`'s rank: more negative is better.
      rank: sql<number>`-10 * ${match.similarity}`.mapWith(Number),
      similarity: match.similarity.mapWith(Number)
    })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(and(eq(entries.language, "ja"), match.condition))
    .orderBy(desc(match.similarity), desc(entries.common), desc(entries.priority))
    .limit(limit)
  return nearBest(rows)
}, Effect.orDie)

const glossesWithNorm = (db: DatabaseShape, norms: ReadonlyArray<string>, language: Language, limit: number) =>
  db
    .select({ ...glossMatch, rank: sql<number>`0`.mapWith(Number) })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(and(eq(entries.language, language), inArray(glosses.norm, norms)))
    .orderBy(desc(entries.common), desc(entries.priority))
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

// Japanese has no word boundaries for full-text search, so this scans; the English dictionary's
// glosses are few enough. Shorter glosses first: the query is more of what they say.

/** Japanese glosses of English words containing `text`, for queries no gloss matches exactly. */
export const searchJapaneseGlosses = Effect.fn("dictionary.searchJapaneseGlosses")(function* (
  db: DatabaseShape,
  text: string,
  limit: number
) {
  if (text.length === 0) return []
  const pattern = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  return yield* db
    .select({ ...glossMatch, rank: sql<number>`-1.0 / length(${glosses.norm})`.mapWith(Number) })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(and(eq(entries.language, "en"), sql`${glosses.norm} LIKE ${pattern}`))
    .orderBy(desc(entries.common), desc(entries.priority), sql`length(${glosses.norm})`)
    .limit(limit)
}, Effect.orDie)

/** Other entries in the same dictionary sharing an exact gloss with the given sense: candidates for "similar words". */
export const sharedGlossCandidates = Effect.fn("dictionary.sharedGlossCandidates")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  sense: number,
  limit: number
) {
  const g1 = alias(glosses, "g1")
  const g2 = alias(glosses, "g2")
  const e1 = alias(entries, "e1")
  return yield* db
    .select({
      entryId: g2.entryId,
      sense: sql<number>`min(${g2.sense})`.mapWith(Number),
      gloss: sql<string>`min(${g2.text})`.mapWith(String)
    })
    .from(g1)
    .innerJoin(e1, eq(e1.id, g1.entryId))
    .innerJoin(g2, and(eq(g2.norm, g1.norm), ne(g2.entryId, g1.entryId)))
    .innerJoin(entries, and(eq(entries.id, g2.entryId), eq(entries.language, e1.language)))
    .where(and(eq(g1.entryId, entryId), eq(g1.sense, sense), sql`length(${g1.norm}) > 1`))
    .groupBy(g2.entryId)
    .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)))
    .limit(limit)
}, Effect.orDie)

/**
 * Common katakana words that may be the loanword of each English word: entries with the word
 * as a gloss, or whose JMDict source (`lsource`) it is; most frequent first, at most `limit`
 * per word. `loanCandidatesIn` is the same search over parsed entries.
 */
export const loanCandidates = Effect.fn("dictionary.loanCandidates")(function* (
  db: DatabaseShape,
  words: ReadonlyArray<string>,
  limit: number
) {
  const wanted = [...new Set(words.map(normalizeGloss))].filter((word) => word.length > 1)
  if (wanted.length === 0) return []
  const katakana = and(
    eq(entries.language, "ja"),
    eq(entries.common, true),
    sql`${entries.headword} ~ ${KATAKANA_WORD}`
  )
  const byGloss = yield* db
    .selectDistinct({ word: glosses.norm, entryId: glosses.entryId, priority: entries.priority })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .where(and(inArray(glosses.norm, wanted), katakana))
  // Sources are matched loosely here and exactly below, as `normalizeGloss` matches glosses.
  const listed = sql.join(
    wanted.map((word) => sql`${word}`),
    sql`, `
  )
  const bySource = yield* db
    .select({ entryId: senses.entryId, sources: senses.sources, priority: entries.priority })
    .from(senses)
    .innerJoin(entries, eq(entries.id, senses.entryId))
    .where(
      and(katakana, sql`EXISTS (SELECT 1 FROM unnest(${senses.sources}) AS source WHERE lower(source) IN (${listed}))`)
    )

  const found = new Map<string, Map<EntryId, { readonly by: LoanCandidate["by"]; readonly priority: number }>>()
  const add = (word: string, entryId: EntryId, by: LoanCandidate["by"], priority: number) => {
    const forWord = found.get(word) ?? new Map()
    if (by === "source" || !forWord.has(entryId)) forWord.set(entryId, { by, priority })
    found.set(word, forWord)
  }
  for (const row of byGloss) add(row.word, row.entryId, "gloss", row.priority)
  for (const row of bySource) {
    for (const source of row.sources) {
      const word = normalizeGloss(source)
      if (wanted.includes(word)) add(word, row.entryId, "source", row.priority)
    }
  }
  return [...found].flatMap(([word, forWord]) =>
    [...forWord]
      .sort(([a, x], [b, y]) => y.priority - x.priority || a - b)
      .slice(0, limit)
      .map(([entryId, { by }]) => ({ word, entryId, by }))
  )
}, Effect.orDie)

/** Commonness and frequency of entries, for ranking without loading them. */
export const entryRanks = Effect.fn("dictionary.entryRanks")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  if (ids.length === 0) return new Map<EntryId, { common: boolean; priority: number }>()
  const rows = yield* db
    .select({ id: entries.id, common: entries.common, priority: entries.priority })
    .from(entries)
    .where(inArray(entries.id, ids))
  return new Map(rows.map((row) => [row.id, { common: row.common, priority: row.priority }]))
}, Effect.orDie)

const missing = (db: DatabaseShape, kind: EnrichmentKind) => {
  switch (kind) {
    case "nuance":
      return notExists(db.select().from(senseNuance).where(eq(senseNuance.entryId, entries.id)))
    case "examples":
      return notExists(db.select().from(examples).where(eq(examples.entryId, entries.id)))
    case "audio":
      return notExists(db.select().from(entryAudio).where(eq(entryAudio.entryId, entries.id)))
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
        query.language ? eq(entries.language, query.language) : undefined,
        query.commonOnly ? eq(entries.common, true) : undefined,
        query.missing ? missing(db, query.missing) : undefined
      )
    )
    .orderBy(desc(entries.priority), entries.id)
    .limit(query.limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

/** A form found by `findForms`: which entry, what was matched, and an inflection's tags. */
export type FormMatch = Effect.Success<ReturnType<typeof findForms>>[number]
/** A gloss found by one of the gloss searches, with its rank and its sense's gloss count. */
export type GlossMatch = Effect.Success<ReturnType<typeof searchGlosses>>[number]
