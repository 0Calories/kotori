import type { EntryRecord, Language } from "@kotori/contracts"
import {
  cautions,
  type DraftCaution,
  emptyIfNull,
  englishDocument,
  entries,
  type EntryId,
  entryAudio,
  entryFrequency,
  examples,
  forms,
  glosses,
  isEnglishForm,
  isJapaneseEntryId,
  isSpelling,
  jobKind,
  labels,
  loanLinks,
  type NoteId,
  notes,
  nullIfEmpty,
  senses,
  type Source,
  tags,
  usagePatterns
} from "@kotori/db"
import {
  englishPhraseVariants,
  nearBest,
  normalizeGloss,
  normalizeJapaneseGloss,
  trigramFloor,
  trigramTargets
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
import { Effect } from "effect"
import { chunks } from "../../db/chunks.ts"
import type { DatabaseShape } from "../../db/Database.ts"
import { matchSenses } from "./import/matchSenses.ts"
import { type ImportEntry, labelsOf, usagePatternsOf, SEED_SOURCES, speaks } from "./import/seedFacts.ts"

/** Enrichment an entry can be missing, used to find work for the worker. */
export type EnrichmentKind = (typeof jobKind.enumValues)[number]

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
const sensesMoved = Effect.fnUntraced(function* (tx: Tx, records: ReadonlyArray<ImportEntry>) {
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
 * place: labels are held and deleted; example sentences, usage patterns, cautions and saved words are
 * only listed, as they are moved in place (keeping their ids, and the sentences their audio).
 */
const takeSenseRows = Effect.fnUntraced(function* (tx: Tx, ids: ReadonlyArray<EntryId>) {
  const held = {
    sentences: yield* tx
      .select({ id: examples.id, entryId: examples.entryId, sense: examples.sense })
      .from(examples)
      .where(inArray(examples.entryId, [...ids])),
    saved: yield* tx
      .select({ id: notes.id, entryId: notes.entryId, sense: notes.sense })
      .from(notes)
      .where(and(inArray(notes.entryId, [...ids]), isNotNull(notes.sense))),
    // What the import rebuilds from the record is gone by now (`deleteSeedFacts`); what is left
    // is Kotori's and learners', which follows its sense.
    labels: yield* tx
      .select()
      .from(labels)
      .where(inArray(labels.entryId, [...ids])),
    usagePatterns: yield* tx
      .select({ id: usagePatterns.id, entryId: usagePatterns.entryId, sense: usagePatterns.sense })
      .from(usagePatterns)
      .where(inArray(usagePatterns.entryId, [...ids])),
    cautions: yield* tx
      .select({ id: cautions.id, entryId: cautions.entryId, sense: cautions.sense })
      .from(cautions)
      .where(and(inArray(cautions.entryId, [...ids]), isNotNull(cautions.sense)))
  }
  yield* tx.delete(labels).where(inArray(labels.entryId, [...ids]))
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
  for (const chunk of chunks(follow(held.labels), 1000)) yield* tx.insert(labels).values([...chunk])

  // Usage patterns and sense-scoped cautions move by id, as sentences do; one whose sense is gone goes.
  for (const table of [usagePatterns, cautions] as const) {
    const rows = table === usagePatterns ? held.usagePatterns : held.cautions
    const gone: Array<number> = []
    const moved = new Map<number, Array<number>>()
    for (const row of rows) {
      const sense = to(row.entryId, row.sense)
      if (sense === null) gone.push(row.id)
      else if (sense !== row.sense) moved.set(sense, [...(moved.get(sense) ?? []), row.id])
    }
    for (const [sense, ids] of moved) yield* tx.update(table).set({ sense }).where(inArray(table.id, ids))
    for (const chunk of chunks(gone, 5000)) yield* tx.delete(table).where(inArray(table.id, [...chunk]))
  }

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

  // Saved words follow too, in the column and in the note content the entry page reads.
  // (learner, entry, sense) is unique, so they pass through negative positions: a swap made
  // in one step would collide halfway. A word whose sense is gone keeps its schedule and
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

/**
 * Deletes the labels and usage patterns an insert rebuilds from its records: those from a seed source or
 * from the entry's own source (an approved Ask Kotori word's are Kotori's), before and after
 * the insert, so a word the curated file takes over from Ask Kotori keeps none of the draft's.
 * What other sources layered on top, such as Kotori's `form` fill on a JMDict word, stays. Runs
 * before the entries are upserted, while they still name their old source.
 */
const deleteSeedFacts = Effect.fnUntraced(function* (tx: Tx, records: ReadonlyArray<ImportEntry>) {
  const stored = new Map<EntryId, Source>()
  for (const chunk of chunks(
    records.map((entry) => entry.id),
    5000
  )) {
    const rows = yield* tx
      .select({ id: entries.id, source: entries.source })
      .from(entries)
      .where(inArray(entries.id, [...chunk]))
    for (const row of rows) stored.set(row.id, row.source)
  }
  const groups = new Map<string, { readonly rebuilt: ReadonlyArray<Source>; readonly ids: Array<EntryId> }>()
  for (const entry of records) {
    const rebuilt = [...new Set<Source>([...SEED_SOURCES, entry.source, stored.get(entry.id) ?? entry.source])]
    const key = rebuilt.join()
    const group = groups.get(key) ?? { rebuilt, ids: [] }
    group.ids.push(entry.id)
    groups.set(key, group)
  }
  for (const { rebuilt, ids: group } of groups.values()) {
    for (const chunk of chunks(group, 5000)) {
      yield* tx.delete(labels).where(and(inArray(labels.entryId, [...chunk]), inArray(labels.source, rebuilt)))
      yield* tx
        .delete(usagePatterns)
        .where(and(inArray(usagePatterns.entryId, [...chunk]), inArray(usagePatterns.source, rebuilt)))
    }
  }
})

/** Writes the labels and usage patterns read from the records' senses; a seed source's label replaces another source's. */
const insertSeedFacts = Effect.fnUntraced(function* (tx: Tx, records: ReadonlyArray<ImportEntry>) {
  const labelRows = records.flatMap((entry) =>
    entry.senses.flatMap((sense, position) =>
      labelsOf(sense).map((code) => ({ entryId: entry.id, sense: position, code, source: entry.source }))
    )
  )
  for (const chunk of chunks(labelRows, 5000)) {
    yield* tx
      .insert(labels)
      .values([...chunk])
      .onConflictDoUpdate({
        target: [labels.entryId, labels.sense, labels.code],
        set: { source: sql`excluded.source` }
      })
  }
  const usagePatternRows = records.flatMap((entry) =>
    entry.senses.flatMap((sense, position) =>
      usagePatternsOf(sense).map((text, index) => ({
        entryId: entry.id,
        sense: position,
        position: index,
        text,
        source: entry.source
      }))
    )
  )
  for (const chunk of chunks(usagePatternRows, 3000)) yield* tx.insert(usagePatterns).values([...chunk])
})

/** Sources of example sentences a seed import writes; Kotori's are the worker's. */
const SEEDED_EXAMPLES = ["tatoeba", "jawiktionary", "enwiktionary"] as const satisfies ReadonlyArray<Source>

/**
 * Brings the records' seeded example sentences into line with their sources: sentences a source
 * no longer gives go, new ones are added, and the rest keep their ids (and any audio). Kotori's
 * sentences are left alone. Runs after senses have moved, so stored sentences are in place.
 */
const syncSeededExamples = Effect.fnUntraced(function* (tx: Tx, records: ReadonlyArray<ImportEntry>) {
  const key = (row: { entryId: EntryId; sense: number; source: string; ja: string; en: string }) =>
    `${row.entryId}\u0000${row.sense}\u0000${row.source}\u0000${row.ja}\u0000${row.en}`
  const wanted = new Map<string, typeof examples.$inferInsert>()
  for (const entry of records) {
    entry.senses.forEach((sense, position) => {
      for (const [index, example] of (sense.examples ?? []).entries()) {
        const row = { entryId: entry.id, sense: position, ...example }
        if (!wanted.has(key(row))) {
          wanted.set(key(row), { ...row, position: index, furigana: example.ja, formality: null, model: null })
        }
      }
    })
  }
  const stale: Array<number> = []
  for (const chunk of chunks(
    records.map((entry) => entry.id),
    5000
  )) {
    const stored = yield* tx
      .select({
        id: examples.id,
        entryId: examples.entryId,
        sense: examples.sense,
        source: examples.source,
        ja: examples.ja,
        en: examples.en
      })
      .from(examples)
      .where(and(inArray(examples.entryId, [...chunk]), inArray(examples.source, SEEDED_EXAMPLES)))
    for (const row of stored) if (!wanted.delete(key(row))) stale.push(row.id)
  }
  for (const chunk of chunks(stale, 5000)) yield* tx.delete(examples).where(inArray(examples.id, [...chunk]))
  for (const chunk of chunks([...wanted.values()], 2000)) yield* tx.insert(examples).values([...chunk])
})

/** Writes the records' frequency signals; an entry whose sources say nothing has no row. */
const syncFrequency = Effect.fnUntraced(function* (tx: Tx, records: ReadonlyArray<ImportEntry>) {
  const rows = records.flatMap((entry) => (speaks(entry.frequency) ? [{ entryId: entry.id, ...entry.frequency }] : []))
  const silent = records.filter((entry) => !speaks(entry.frequency)).map((entry) => entry.id)
  for (const chunk of chunks(silent, 5000)) {
    yield* tx.delete(entryFrequency).where(inArray(entryFrequency.entryId, [...chunk]))
  }
  for (const chunk of chunks(rows, 5000)) {
    yield* tx
      .insert(entryFrequency)
      .values([...chunk])
      .onConflictDoUpdate({
        target: entryFrequency.entryId,
        set: {
          everyday: sql`excluded.everyday`,
          spokenCount: sql`excluded.spoken_count`,
          score: sql`excluded.score`
        }
      })
  }
})

export interface InsertOptions {
  /**
   * The records are a seed import's, carrying everything their sources say: their seeded example
   * sentences and frequency signals replace the stored ones. Off, as when an alias re-inserts a
   * stored entry, those are left as they are.
   */
  readonly seeded?: boolean | undefined
}

/**
 * Inserts or replaces entries and their forms, senses and glosses, and the labels and usage patterns
 * read from their senses. Enrichment survives for every sense the entry still has.
 */
export const insertEntries = Effect.fn("dictionary.insertEntries")(function* (
  db: DatabaseShape,
  records: ReadonlyArray<ImportEntry>,
  options: InsertOptions = {}
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
      yield* deleteSeedFacts(tx, records)
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
            source: entry.source,
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
            source: sql`excluded.source`,
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
          tags: nullIfEmpty(form.tags),
          priorities: nullIfEmpty(form.priorities),
          restrictions: nullIfEmpty(form.restrictions),
          noKanji: form.noKanji
        }))
      })
      for (const chunk of chunks(formRows, 2000)) yield* tx.insert(forms).values([...chunk])

      const senseRows = records.flatMap((entry) =>
        entry.senses.map((sense, position) => ({
          entryId: entry.id,
          position,
          pos: nullIfEmpty(sense.pos),
          misc: nullIfEmpty(sense.misc),
          fields: nullIfEmpty(sense.fields),
          dialects: nullIfEmpty(sense.dialects),
          info: nullIfEmpty(sense.info),
          stagk: nullIfEmpty(sense.stagk),
          stagr: nullIfEmpty(sense.stagr),
          xrefs: nullIfEmpty(sense.xrefs),
          antonyms: nullIfEmpty(sense.antonyms),
          origins: nullIfEmpty(sense.origins),
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
              origins: sql`excluded.origins`,
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

      yield* insertSeedFacts(tx, records)
      if (options.seeded) {
        yield* syncSeededExamples(tx, records)
        yield* syncFrequency(tx, records)
      }
    })
  )
}, Effect.orDie)

/**
 * Links katakana loans to the English words they come from, as JMDict names them (`lsource`):
 * one row per pair, read from both entries. Re-run after either dictionary is imported, it adds
 * the pairs JMDict names now, drops those it no longer names, and points each at the English
 * entry spelled like it (exactly, else in another case). A verdict on the meaning, which JMDict
 * doesn't give, survives on a pair JMDict still names, with whose it is (`meaning_source`); a
 * pair it no longer names goes, verdict and all. A pair Kotori named that JMDict now names
 * becomes JMDict's, keeping its verdict. Pairs only Kotori names are the loan file's to keep.
 */
export const linkLoans = Effect.fn("dictionary.linkLoans")(function* (db: DatabaseShape) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // The pairs JMDict names now, by the katakana headword: a pair whose word changed headword
      // is a different pair, and the old one goes. Two entries spelled alike may name the same
      // word; the lower id, JMDict's older entry, holds it.
      // One statement: the delete and the upsert see the same snapshot and touch disjoint pairs.
      yield* tx.execute(sql`
        WITH wanted AS (
          SELECT DISTINCT ON (e.headword, o.word) e.headword AS katakana, e.id AS entry_id, o.word AS english
          FROM ${senses} AS se
          JOIN ${entries} AS e ON e.id = se.entry_id
          CROSS JOIN LATERAL jsonb_to_recordset(coalesce(se.origins, '[]'::jsonb)) AS o(language text, word text)
          WHERE e.source = 'jmdict' AND e.language = 'ja' AND o.language = 'eng' AND o.word IS NOT NULL
          ORDER BY e.headword, o.word, e.id
        ), dropped AS (
          DELETE FROM ${loanLinks} AS l
          WHERE l.source = 'jmdict'
            AND NOT EXISTS (SELECT 1 FROM wanted AS w WHERE w.katakana = l.katakana AND w.english = l.english)
        )
        INSERT INTO ${loanLinks} (katakana, katakana_entry_id, english, source)
        SELECT katakana, entry_id, english, 'jmdict' FROM wanted
        ON CONFLICT (katakana, english)
        DO UPDATE SET katakana_entry_id = excluded.katakana_entry_id, source = excluded.source
        WHERE (${loanLinks}.katakana_entry_id, ${loanLinks}.source) IS DISTINCT FROM (excluded.katakana_entry_id, excluded.source)
      `)
      yield* tx.execute(sql`
        WITH matched AS (
          SELECT DISTINCT ON (l.id) l.id, e.id AS entry_id
          FROM ${loanLinks} AS l
          LEFT JOIN ${entries} AS e ON e.language = 'en' AND lower(e.headword) = lower(l.english)
          ORDER BY l.id, (e.headword = l.english) DESC NULLS LAST, e.priority DESC NULLS LAST, e.id
        )
        UPDATE ${loanLinks} AS l SET english_entry_id = matched.entry_id
        FROM matched
        WHERE l.id = matched.id AND l.english_entry_id IS DISTINCT FROM matched.entry_id
      `)
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

/** Adds tag names, replacing those of codes already known; codes the other dictionary uses are kept. */
export const saveTags = Effect.fn("dictionary.saveTags")(function* (
  db: DatabaseShape,
  rows: ReadonlyArray<{ readonly code: string; readonly name: string }>
) {
  // One row per code, or the upsert would touch a row twice; the first name wins.
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

/** Every headword in one dictionary with its entry id, so a re-import keeps ids stable. */
export const headwordIds = Effect.fn("dictionary.headwordIds")(function* (db: DatabaseShape, language: Language) {
  const rows = yield* db
    .select({ id: entries.id, headword: entries.headword })
    .from(entries)
    .where(eq(entries.language, language))
  return new Map(rows.map((row) => [row.headword, row.id]))
}, Effect.orDie)

/** An entry's id and language, or undefined when there is none: enough to report its enrichment. */
export const entryLanguage = Effect.fn("dictionary.entryLanguage")(function* (db: DatabaseShape, id: EntryId) {
  const [row] = yield* db.select({ id: entries.id, language: entries.language }).from(entries).where(eq(entries.id, id))
  return row
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
          .map(({ entryId: _, position: __, ...form }) => ({
            ...form,
            tags: emptyIfNull(form.tags),
            priorities: emptyIfNull(form.priorities),
            restrictions: emptyIfNull(form.restrictions)
          })),
        senses: senseRows
          .filter((sense) => sense.entryId === id)
          .map(({ entryId: _, position, ...sense }) => ({
            ...sense,
            pos: emptyIfNull(sense.pos),
            misc: emptyIfNull(sense.misc),
            fields: emptyIfNull(sense.fields),
            dialects: emptyIfNull(sense.dialects),
            info: emptyIfNull(sense.info),
            stagk: emptyIfNull(sense.stagk),
            stagr: emptyIfNull(sense.stagr),
            xrefs: emptyIfNull(sense.xrefs),
            antonyms: emptyIfNull(sense.antonyms),
            origins: emptyIfNull(sense.origins),
            glosses: glossRows
              .filter((gloss) => gloss.entryId === id && gloss.sense === position)
              .map((gloss) => ({ text: gloss.text, type: gloss.type }))
          }))
      }
    ]
  })
}, Effect.orDie)

/** A list column as an array, empty where the row stores NULL (see `@kotori/db`'s `textList`). */
const listOf = <C extends AnyColumn>(column: C) => sql`coalesce(${column}, '{}')`.mapWith(column)

/** `lower(text)`, which `forms_folded` indexes for English forms, so English matches whatever the case. */
const folded = sql<string>`lower(${forms.text})`

// The searches' indexes are partial (see `@kotori/db`): the forms' hold English spellings or forms,
// `glosses_document` Japanese words' glosses. The planner can't tell that from the entry's language,
// so each search also states its index's condition (`isEnglishForm`, `isSpelling`,
// `isJapaneseEntryId`); without it, it would scan the table.

/** `englishDocument` of a form's text, the expression `forms_document` indexes. */
const formDocument = englishDocument(forms.text)

/** `englishDocument` of a gloss's text, the expression `glosses_document` indexes for Japanese words. */
const glossDocument = englishDocument(glosses.text)

/**
 * A query's words as the `english` configuration stems them, or, when every word is one it drops
 * ("what it is"), word for word with `simple`: the documents of such phrases are built the same
 * way (`englishDocument`), so the two still meet.
 */
const tsquery = (query: string) =>
  sql`CASE WHEN numnode(plainto_tsquery('english', ${query})) = 0 THEN plainto_tsquery('simple', ${query}) ELSE plainto_tsquery('english', ${query}) END`

/** Matches when any of `queries` does, each requiring all of its words (`plainto_tsquery`). */
const toTsquery = (queries: ReadonlyArray<string>) => sql`(${sql.join(queries.map(tsquery), sql` || `)})`

/** Entries in one dictionary with a form equal to one of `texts`; English ignores case. */
export const findForms = Effect.fn("dictionary.findForms")(function* (
  db: DatabaseShape,
  texts: ReadonlyArray<string>,
  language: Language = "ja"
) {
  if (texts.length === 0) return []
  const match = { entryId: forms.entryId, text: forms.text, kind: forms.kind, tags: listOf(forms.tags) }
  if (language === "ja") {
    return yield* db
      .select(match)
      .from(forms)
      .innerJoin(entries, eq(entries.id, forms.entryId))
      .where(and(eq(entries.language, language), inArray(forms.text, texts)))
  }
  // An English form's kind says it is English, so there is nothing to join: the planner has no
  // statistics for `lower(text)` from a partial index, and its guess at the matches made it hash
  // every English entry (8 ms where the lookup takes a tenth of one).
  return yield* db
    .select(match)
    .from(forms)
    .where(
      and(
        isEnglishForm(forms.kind),
        inArray(
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
        language === "ja" ? ne(forms.kind, "inflection") : isSpelling(forms.kind),
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
  const rank = sql<number>`-ts_rank_cd(${formDocument}, ${tsquery})`
  return yield* db
    .select({
      entryId: forms.entryId,
      text: forms.text,
      kind: forms.kind,
      tags: listOf(forms.tags),
      rank: rank.mapWith(Number)
    })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(and(eq(entries.language, "en"), isSpelling(forms.kind), sql`${formDocument} @@ ${tsquery}`))
    .orderBy(rank, desc(entries.common), desc(entries.priority), sql`length(${forms.text})`)
    .limit(limit)
}, Effect.orDie)

/**
 * Trigram similarity of `column` to an English query (`trigramTargets`); `condition` is pg_trgm's
 * `%`, at its 0.3 threshold. Null when the query is too short to compare.
 */
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
  const match = trigramMatch(forms.text, query)
  if (match === null) return []
  const rows = yield* db
    .select({
      entryId: forms.entryId,
      text: forms.text,
      kind: forms.kind,
      tags: listOf(forms.tags),
      similarity: match.similarity.mapWith(Number)
    })
    .from(forms)
    .innerJoin(entries, eq(entries.id, forms.entryId))
    .where(and(eq(entries.language, "en"), isSpelling(forms.kind), match.condition))
    .orderBy(desc(match.similarity), desc(entries.common), desc(entries.priority), sql`length(${forms.text})`)
    .limit(limit)
  return nearBest(rows, trigramFloor(query))
}, Effect.orDie)

const glossMatch = {
  entryId: glosses.entryId,
  sense: glosses.sense,
  position: glosses.position,
  text: glosses.text,
  glossCount,
  misc: listOf(senses.misc)
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
  const rank = sql<number>`-ts_rank_cd(${glossDocument}, ${tsquery})`
  return yield* db
    .select({ ...glossMatch, rank: rank.mapWith(Number) })
    .from(glosses)
    .innerJoin(entries, eq(entries.id, glosses.entryId))
    .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
    .where(and(eq(entries.language, "ja"), isJapaneseEntryId(glosses.entryId), sql`${glossDocument} @@ ${tsquery}`))
    .orderBy(rank)
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
    case "examples":
      // Seeded sentences don't count: Claude's are the ones the worker writes.
      return notExists(
        db
          .select()
          .from(examples)
          .where(and(eq(examples.entryId, entries.id), eq(examples.source, "kotori")))
      )
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

/**
 * The entry a word names, when exactly one is written that way (inflections aside): 上手 names
 * two (じょうず, うわて), so it names neither rather than guess.
 */
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
 * names where exactly one matches. Cautions from other sources stay; together they keep the cap.
 */
export const saveKotoriCautions = Effect.fn("dictionary.saveKotoriCautions")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  language: Language,
  drafted: ReadonlyArray<DraftCaution>
) {
  const rows: Array<Omit<typeof cautions.$inferInsert, "rank">> = []
  for (const caution of drafted) {
    rows.push({
      entryId,
      sense: caution.sense,
      kind: caution.kind,
      text: caution.text,
      aboutEntryId: caution.about === null ? null : yield* resolveWord(db, caution.about, language),
      source: "kotori" as const
    })
  }
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(cautions).where(and(eq(cautions.entryId, entryId), eq(cautions.source, "kotori")))
      const kept = yield* tx.select({ rank: cautions.rank }).from(cautions).where(eq(cautions.entryId, entryId))
      const taken = new Set(kept.map((row) => row.rank))
      const free = [1, 2, 3].filter((rank) => !taken.has(rank))
      const placed = rows.slice(0, free.length).map((row, index) => ({ ...row, rank: free[index]! }))
      if (placed.length > 0) yield* tx.insert(cautions).values(placed)
    })
  )
}, Effect.orDie)
