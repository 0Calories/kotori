import type { EntryRecord, Language } from "@kotori/contracts"
import {
  cautions,
  type DraftCaution,
  emptyIfNull,
  englishDocument,
  entries,
  type EntryId,
  type EntryReview,
  reviewsWhere,
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
  max,
  min,
  ne,
  notExists,
  notInArray,
  sql
} from "drizzle-orm"
import { Effect } from "effect"
import { chunks } from "../../db/chunks.ts"
import type { DatabaseShape } from "../../db/Database.ts"
import { type EntryScope, outsideScope, reviewedAs } from "./entryReview.ts"
import { matchSenses } from "./import/matchSenses.ts"
import { type ImportEntry, labelsOf, usagePatternsOf, SEED_SOURCES, speaks } from "./import/seedFacts.ts"

export type EnrichmentKind = (typeof jobKind.enumValues)[number]

export interface PriorityQuery {
  readonly limit: number
  readonly missing?: EnrichmentKind | undefined
  readonly commonOnly?: boolean | undefined
  readonly language?: Language | undefined
}

const glossCount = sql<number>`(
  SELECT count(*) FROM ${glosses} AS g2
  WHERE g2.entry_id = ${glosses.entryId} AND g2.sense = ${glosses.sense}
)`.mapWith(Number)

type Tx = Parameters<Parameters<DatabaseShape["transaction"]>[0]>[0]

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

const takeSenseRows = Effect.fnUntraced(function* (tx: Tx, ids: ReadonlyArray<EntryId>) {
  const held = {
    sentences: yield* tx
      .select({ id: examples.id, entryId: examples.entryId, sense: examples.sense })
      .from(examples)
      .where(inArray(examples.entryId, [...ids])),
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

  // Update by pre-collected row IDs so swapping two sense positions does not move rows twice.
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
})

// Delete facts from both the old and new entry.source before upserting entries so a curated entry replacing an approved Kotori draft drops the draft's facts while keeping offline-pass overlays.
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

const SEEDED_EXAMPLES = ["tatoeba", "jawiktionary", "enwiktionary"] as const satisfies ReadonlyArray<Source>

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
  readonly seeded?: boolean | undefined
}

export const insertEntries = Effect.fn("dictionary.insertEntries")(function* (
  db: DatabaseShape,
  records: ReadonlyArray<ImportEntry>,
  options: InsertOptions = {}
) {
  if (records.length === 0) return
  const ids = records.map((entry) => entry.id)
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // Upsert senses in place and delete only trailing positions >= count so foreign keys from examples/labels/cautions do not cascade-delete surviving senses.
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
            priority: entry.priority,
            review: entry.review ?? "approved"
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

export const linkLoans = Effect.fn("dictionary.linkLoans")(function* (db: DatabaseShape) {
  const inDictionary = sql`(${sql.join(
    reviewsWhere("inDictionary").map((review) => sql`${review}::entry_review`),
    sql`, `
  )})`
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // Run DELETE and INSERT in one data-modifying CTE so both see the same snapshot; when homographs share a katakana headword and origin, lowest entry id wins.
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
          LEFT JOIN ${entries} AS e ON e.language = 'en' AND e.review IN ${inDictionary} AND lower(e.headword) = lower(l.english)
          ORDER BY l.id, (e.headword = l.english) DESC NULLS LAST, e.priority DESC NULLS LAST, e.id
        )
        UPDATE ${loanLinks} AS l SET english_entry_id = matched.entry_id
        FROM matched
        WHERE l.id = matched.id AND l.english_entry_id IS DISTINCT FROM matched.entry_id
      `)
    })
  )
}, Effect.orDie)

export const deleteEntries = Effect.fn("dictionary.deleteEntries")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  for (const chunk of chunks(ids, 5000)) yield* db.delete(entries).where(inArray(entries.id, [...chunk]))
}, Effect.orDie)

export const saveTags = Effect.fn("dictionary.saveTags")(function* (
  db: DatabaseShape,
  rows: ReadonlyArray<{ readonly code: string; readonly name: string }>
) {
  // Deduplicate by code because Postgres ON CONFLICT DO UPDATE cannot affect the same target row twice in one statement.
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

export const entryCount = (db: DatabaseShape) => db.$count(entries, reviewedAs("inDictionary")).pipe(Effect.orDie)

export const countOf = (db: DatabaseShape, language: Language) =>
  db.$count(entries, and(eq(entries.language, language), reviewedAs("inDictionary"))).pipe(Effect.orDie)

export const headwordIds = Effect.fn("dictionary.headwordIds")(function* (db: DatabaseShape, language: Language) {
  const rows = yield* db
    .select({ id: entries.id, headword: entries.headword })
    .from(entries)
    .where(and(eq(entries.language, language), reviewedAs("inDictionary")))
  return new Map(rows.map((row) => [row.headword, row.id]))
}, Effect.orDie)

export const topEntryId = Effect.fn("dictionary.topEntryId")(function* (
  db: DatabaseShape,
  language: Language,
  from: EntryId
) {
  const [row] = yield* db
    .select({ top: max(entries.id) })
    .from(entries)
    .where(and(eq(entries.language, language), gte(entries.id, from)))
  return Math.max(row?.top ?? 0, from)
}, Effect.orDie)

export const entryLanguage = Effect.fn("dictionary.entryLanguage")(function* (db: DatabaseShape, id: EntryId) {
  const [row] = yield* db
    .select({ id: entries.id, language: entries.language, review: entries.review })
    .from(entries)
    .where(eq(entries.id, id))
  return row
}, Effect.orDie)

export type StoredEntry = EntryRecord & { readonly review: EntryReview }

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
  return ids.flatMap((id): Array<StoredEntry> => {
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

const listOf = <C extends AnyColumn>(column: C) => sql`coalesce(${column}, '{}')`.mapWith(column)

const folded = sql<string>`lower(${forms.text})`

// Repeat partial-index predicates (isEnglishForm, isSpelling, isJapaneseEntryId) in WHERE clauses because the Postgres planner cannot infer them from entries.language.
const formDocument = englishDocument(forms.text)

const glossDocument = englishDocument(glosses.text)

// Fall back to 'simple' when 'english' stems every token away as stop words (e.g. "what it is"), matching englishDocument.
const tsquery = (query: string) =>
  sql`CASE WHEN numnode(plainto_tsquery('english', ${query})) = 0 THEN plainto_tsquery('simple', ${query}) ELSE plainto_tsquery('english', ${query}) END`

const toTsquery = (queries: ReadonlyArray<string>) => sql`(${sql.join(queries.map(tsquery), sql` || `)})`

export const findForms = Effect.fn("dictionary.findForms")(function* (
  db: DatabaseShape,
  texts: ReadonlyArray<string>,
  language: Language = "ja",
  scope: EntryScope = "inDictionary"
) {
  if (texts.length === 0) return []
  const match = { entryId: forms.entryId, text: forms.text, kind: forms.kind, tags: listOf(forms.tags) }
  const inScope = notInArray(forms.entryId, outsideScope(db, scope))
  if (language === "ja") {
    return yield* db
      .select(match)
      .from(forms)
      .innerJoin(entries, eq(entries.id, forms.entryId))
      .where(and(eq(entries.language, language), inArray(forms.text, texts), inScope))
  }
  // Omit the entries join for English forms because the planner lacks lower(text) stats on the partial index and otherwise hash-joins every English entry.
  return yield* db
    .select(match)
    .from(forms)
    .where(
      and(
        isEnglishForm(forms.kind),
        inArray(
          folded,
          texts.map((text) => text.toLowerCase())
        ),
        inScope
      )
    )
}, Effect.orDie)

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
        // forms.text uses C collation, so a >= / < '\u{10FFFF}' range scan uses the B-tree index for prefix matching.
        sql`${text} >= ${start} AND ${text} < ${start + "\u{10FFFF}"}`
      )
    )
    .groupBy(forms.entryId)
    .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)), min(sql`length(${forms.text})`))
    .limit(limit)
  return rows.map((row) => row.id)
}, Effect.orDie)

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

export const searchGlosses = Effect.fn("dictionary.searchGlosses")(function* (
  db: DatabaseShape,
  queries: ReadonlyArray<string>,
  limit: number
) {
  if (queries.length === 0) return []
  const tsquery = toTsquery(queries)
  // Negate ts_rank_cd so ascending sort orders higher cover-density (closer query words) first.
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

export const findGlossesExact = Effect.fn("dictionary.findGlossesExact")(function* (
  db: DatabaseShape,
  query: string,
  limit: number
) {
  const norms = englishPhraseVariants(query)
  if (norms.length === 0) return []
  return yield* glossesWithNorm(db, norms, "ja", limit)
}, Effect.orDie)

export const findJapaneseGlosses = Effect.fn("dictionary.findJapaneseGlosses")(function* (
  db: DatabaseShape,
  norms: ReadonlyArray<string>,
  limit: number
) {
  const wanted = norms.filter((norm) => norm.length > 0)
  if (wanted.length === 0) return []
  return yield* glossesWithNorm(db, wanted, "en", limit)
}, Effect.orDie)

// Postgres has no built-in Japanese tokenizer, so fall back to a LIKE scan over the small English-dictionary gloss set.
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

export interface EntryRank {
  readonly common: boolean
  readonly priority: number
  readonly review: EntryReview
}

export const entryRanks = Effect.fn("dictionary.entryRanks")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<EntryId>
) {
  if (ids.length === 0) return new Map<EntryId, EntryRank>()
  const rows = yield* db
    .select({ id: entries.id, common: entries.common, priority: entries.priority, review: entries.review })
    .from(entries)
    .where(inArray(entries.id, ids))
  return new Map(rows.map((row) => [row.id, { common: row.common, priority: row.priority, review: row.review }]))
}, Effect.orDie)

const missing = (db: DatabaseShape, kind: EnrichmentKind) => {
  switch (kind) {
    case "examples":
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

export const entriesByPriority = Effect.fn("dictionary.entriesByPriority")(function* (
  db: DatabaseShape,
  query: PriorityQuery
) {
  const rows = yield* db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        reviewedAs("inDictionary"),
        query.language ? eq(entries.language, query.language) : undefined,
        query.commonOnly ? eq(entries.common, true) : undefined,
        query.missing ? missing(db, query.missing) : undefined
      )
    )
    .orderBy(desc(entries.priority), entries.id)
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
