import { and, asc, desc, eq, exists, gte, inArray, max, min, ne, notExists, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, Effect, Layer } from "effect"
import { Database } from "./Database.ts"
import { type EntryRecord, normalizeGloss } from "./records.ts"
import { chunks } from "./rows.ts"
import { entries, entryAudio, examples, forms, glosses, jobKind, senseNuance, senses, tags } from "./schema/index.ts"

export interface FormMatch {
  readonly entryId: number
  readonly text: string
  readonly kind: "kanji" | "kana"
}

export interface GlossMatch {
  readonly entryId: number
  readonly sense: number
  readonly position: number
  readonly text: string
  /** Ascending: more negative is a better match (negated `ts_rank`, 0 for exact matches). */
  readonly rank: number
  /** How many glosses the matched sense has; a lone gloss is a more specific match. */
  readonly glossCount: number
  readonly misc: ReadonlyArray<string>
}

export interface Candidate {
  readonly entryId: number
  readonly sense: number
  readonly gloss: string
}

/** Enrichment an entry can be missing, used to find work for the worker. */
export type EnrichmentKind = (typeof jobKind.enumValues)[number]

export interface PriorityQuery {
  readonly limit: number
  readonly missing?: EnrichmentKind | undefined
  /** Only entries that already have this enrichment, for regenerating it. */
  readonly enriched?: EnrichmentKind | undefined
  readonly commonOnly?: boolean | undefined
}

export class DictionaryRepo extends Context.Service<
  DictionaryRepo,
  {
    /** Inserts or replaces entries and their forms, senses and glosses. Enrichment survives for every sense the entry still has. */
    insertEntries(entries: ReadonlyArray<EntryRecord>): Effect.Effect<void>
    replaceTags(tags: ReadonlyArray<{ readonly code: string; readonly label: string }>): Effect.Effect<void>
    readonly tags: Effect.Effect<ReadonlyMap<string, string>>
    readonly count: Effect.Effect<number>
    getEntries(ids: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<EntryRecord>>
    /** Entries with a form exactly equal to one of `texts`. */
    findForms(texts: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<FormMatch>>
    /** Entry ids with a form starting with `prefix`, most common first. */
    findFormPrefix(prefix: string, limit: number): Effect.Effect<ReadonlyArray<number>>
    /** Full-text search over English glosses; every word of the plain-text query must match. */
    searchGlosses(query: string, limit: number): Effect.Effect<ReadonlyArray<GlossMatch>>
    /** Glosses whose normalised text equals `normalizeGloss(query)`. */
    findGlossesExact(query: string, limit: number): Effect.Effect<ReadonlyArray<GlossMatch>>
    /** Other entries sharing an exact gloss with the given sense: candidates for "similar words". */
    sharedGlossCandidates(entryId: number, sense: number, limit: number): Effect.Effect<ReadonlyArray<Candidate>>
    /** Commonness and frequency of entries, for ranking without loading them. */
    ranks(
      ids: ReadonlyArray<number>
    ): Effect.Effect<ReadonlyMap<number, { readonly common: boolean; readonly priority: number }>>
    /** Entry ids in priority order, optionally only those still missing some enrichment. */
    entriesByPriority(query: PriorityQuery): Effect.Effect<ReadonlyArray<number>>
  }
>()("@kotori/db/DictionaryRepo") {
  static readonly layer = Layer.effect(
    DictionaryRepo,
    Effect.gen(function* () {
      const db = yield* Database

      /** How many glosses the sense of a gloss row has. */
      const glossCount = sql<number>`(
        SELECT count(*) FROM ${glosses} AS g2
        WHERE g2.entry_id = ${glosses.entryId} AND g2.sense = ${glosses.sense}
      )`.mapWith(Number)

      const insertEntries = Effect.fn("DictionaryRepo.insertEntries")(function* (records: ReadonlyArray<EntryRecord>) {
        if (records.length === 0) return
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

      const replaceTags = Effect.fn("DictionaryRepo.replaceTags")(function* (
        rows: ReadonlyArray<{ readonly code: string; readonly label: string }>
      ) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(tags)
            for (const chunk of chunks(rows, 1000)) {
              yield* tx.insert(tags).values(chunk.map((tag) => ({ code: tag.code, label: tag.label })))
            }
          })
        )
      }, Effect.orDie)

      const tagMap = db
        .select()
        .from(tags)
        .pipe(
          Effect.map((rows) => new Map(rows.map((row) => [row.code, row.label]))),
          Effect.orDie
        )

      const count = db.$count(entries).pipe(Effect.orDie)

      const getEntries = Effect.fn("DictionaryRepo.getEntries")(function* (ids: ReadonlyArray<number>) {
        if (ids.length === 0) return []
        const [entryRows, formRows, senseRows, glossRows] = yield* Effect.all([
          db.select().from(entries).where(inArray(entries.id, ids)),
          db
            .select()
            .from(forms)
            .where(inArray(forms.entryId, ids))
            .orderBy(forms.entryId, asc(forms.kind), forms.position),
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
                .map(({ entryId: _, position: __, ...form }) => form),
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

      const findForms = Effect.fn("DictionaryRepo.findForms")(function* (texts: ReadonlyArray<string>) {
        if (texts.length === 0) return []
        return yield* db
          .select({ entryId: forms.entryId, text: forms.text, kind: forms.kind })
          .from(forms)
          .where(inArray(forms.text, texts))
      }, Effect.orDie)

      // A range scan on the bytewise-collated text, so the index serves it.
      const findFormPrefix = Effect.fn("DictionaryRepo.findFormPrefix")(function* (prefix: string, limit: number) {
        const rows = yield* db
          .select({ id: forms.entryId })
          .from(forms)
          .innerJoin(entries, eq(entries.id, forms.entryId))
          .where(sql`${forms.text} >= ${prefix} AND ${forms.text} < ${prefix + "\u{10FFFF}"}`)
          .groupBy(forms.entryId)
          .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)), min(sql`length(${forms.text})`))
          .limit(limit)
        return rows.map((row) => row.id)
      }, Effect.orDie)

      const glossMatch = {
        entryId: glosses.entryId,
        sense: glosses.sense,
        position: glosses.position,
        text: glosses.text,
        glossCount,
        misc: senses.misc
      }

      // `rank` is negated ts_rank so it keeps the old FTS5 bm25 shape: ascending, more negative = better.
      const searchGlosses = Effect.fn("DictionaryRepo.searchGlosses")(function* (query: string, limit: number) {
        const tsquery = sql`plainto_tsquery('english', ${query})`
        return yield* db
          .select({ ...glossMatch, rank: sql<number>`-ts_rank(${glosses.document}, ${tsquery})`.mapWith(Number) })
          .from(glosses)
          .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
          .where(sql`${glosses.document} @@ ${tsquery}`)
          .orderBy(sql`-ts_rank(${glosses.document}, ${tsquery})`)
          .limit(limit)
      }, Effect.orDie)

      const findGlossesExact = Effect.fn("DictionaryRepo.findGlossesExact")(function* (query: string, limit: number) {
        const norm = normalizeGloss(query)
        if (norm.length === 0) return []
        return yield* db
          .select({ ...glossMatch, rank: sql<number>`0`.mapWith(Number) })
          .from(glosses)
          .innerJoin(entries, eq(entries.id, glosses.entryId))
          .innerJoin(senses, and(eq(senses.entryId, glosses.entryId), eq(senses.position, glosses.sense)))
          .where(eq(glosses.norm, norm))
          .orderBy(desc(entries.common), desc(entries.priority))
          .limit(limit)
      }, Effect.orDie)

      const sharedGlossCandidates = Effect.fn("DictionaryRepo.sharedGlossCandidates")(function* (
        entryId: number,
        sense: number,
        limit: number
      ) {
        const g1 = alias(glosses, "g1")
        const g2 = alias(glosses, "g2")
        return yield* db
          .select({
            entryId: g2.entryId,
            sense: sql<number>`min(${g2.sense})`.mapWith(Number),
            gloss: sql<string>`min(${g2.text})`.mapWith(String)
          })
          .from(g1)
          .innerJoin(g2, and(eq(g2.norm, g1.norm), ne(g2.entryId, g1.entryId)))
          .innerJoin(entries, eq(entries.id, g2.entryId))
          .where(and(eq(g1.entryId, entryId), eq(g1.sense, sense), sql`length(${g1.norm}) > 1`))
          .groupBy(g2.entryId)
          .orderBy(desc(sql`bool_or(${entries.common})`), desc(max(entries.priority)))
          .limit(limit)
      }, Effect.orDie)

      const ranks = Effect.fn("DictionaryRepo.ranks")(function* (ids: ReadonlyArray<number>) {
        if (ids.length === 0) return new Map<number, { common: boolean; priority: number }>()
        const rows = yield* db
          .select({ id: entries.id, common: entries.common, priority: entries.priority })
          .from(entries)
          .where(inArray(entries.id, ids))
        return new Map(rows.map((row) => [row.id, { common: row.common, priority: row.priority }]))
      }, Effect.orDie)

      const enrichmentOf = (kind: EnrichmentKind) => {
        switch (kind) {
          case "nuance":
            return db.select().from(senseNuance).where(eq(senseNuance.entryId, entries.id))
          case "examples":
            return db.select().from(examples).where(eq(examples.entryId, entries.id))
          case "audio":
            return db.select().from(entryAudio).where(eq(entryAudio.entryId, entries.id))
        }
      }

      const entriesByPriority = Effect.fn("DictionaryRepo.entriesByPriority")(function* (query: PriorityQuery) {
        const rows = yield* db
          .select({ id: entries.id })
          .from(entries)
          .where(
            and(
              query.commonOnly ? eq(entries.common, true) : undefined,
              query.missing ? notExists(enrichmentOf(query.missing)) : undefined,
              query.enriched ? exists(enrichmentOf(query.enriched)) : undefined
            )
          )
          .orderBy(desc(entries.priority), entries.id)
          .limit(query.limit)
        return rows.map((row) => row.id)
      }, Effect.orDie)

      return DictionaryRepo.of({
        insertEntries,
        replaceTags,
        tags: tagMap,
        count,
        getEntries,
        findForms,
        findFormPrefix,
        searchGlosses,
        findGlossesExact,
        sharedGlossCandidates,
        ranks,
        entriesByPriority
      })
    })
  )
}
