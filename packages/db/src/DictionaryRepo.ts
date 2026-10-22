import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { type EntryRecord, GlossRecord, normalizeGloss } from "./records.ts"

const StringList = Schema.fromJsonString(Schema.Array(Schema.String))

const EntryRow = Schema.Struct({
  id: Schema.Int,
  headword: Schema.String,
  reading: Schema.String,
  common: Schema.Boolean,
  priority: Schema.Int
})

const FormRow = Schema.Struct({
  entryId: Schema.Int,
  kind: Schema.Literals(["kanji", "kana"]),
  text: Schema.String,
  common: Schema.Boolean,
  tags: StringList,
  priorities: StringList,
  restrictions: StringList,
  noKanji: Schema.Boolean
})

const SenseRow = Schema.Struct({
  entryId: Schema.Int,
  glosses: Schema.fromJsonString(Schema.Array(GlossRecord)),
  pos: StringList,
  misc: StringList,
  fields: StringList,
  dialects: StringList,
  info: StringList,
  stagk: StringList,
  stagr: StringList,
  xrefs: StringList,
  antonyms: StringList
})

const FormMatch = Schema.Struct({
  entryId: Schema.Int,
  text: Schema.String,
  kind: Schema.Literals(["kanji", "kana"])
})
export type FormMatch = typeof FormMatch.Type

const GlossMatch = Schema.Struct({
  entryId: Schema.Int,
  sense: Schema.Int,
  position: Schema.Int,
  text: Schema.String,
  rank: Schema.Number,
  /** How many glosses the matched sense has; a lone gloss is a more specific match. */
  glossCount: Schema.Int,
  misc: StringList
})
export type GlossMatch = typeof GlossMatch.Type

const Candidate = Schema.Struct({
  entryId: Schema.Int,
  sense: Schema.Int,
  gloss: Schema.String
})
export type Candidate = typeof Candidate.Type

const IdRow = Schema.Struct({ id: Schema.Int })
const RankRow = Schema.Struct({ id: Schema.Int, common: Schema.Boolean, priority: Schema.Int })
const CountRow = Schema.Struct({ n: Schema.Int })
const TagRow = Schema.Struct({ code: Schema.String, label: Schema.String })

/** Enrichment an entry can be missing, used to find work for the worker. */
export type EnrichmentKind = "nuance" | "examples" | "audio"

export interface PriorityQuery {
  readonly limit: number
  readonly missing?: EnrichmentKind | undefined
  readonly commonOnly?: boolean | undefined
}

const decodeRows = <S extends Schema.Constraint>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

const chunks = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export class DictionaryRepo extends Context.Service<
  DictionaryRepo,
  {
    /** Inserts or replaces entries. The full-text index is a generated column, so imports need no rebuild. */
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
      const sql = yield* SqlClient.SqlClient

      const insertEntries = Effect.fn("DictionaryRepo.insertEntries")(
        function* (entries: ReadonlyArray<EntryRecord>) {
          if (entries.length === 0) return
          const ids = entries.map((entry) => entry.id)
          yield* sql`DELETE FROM glosses WHERE entry_id IN ${sql.in(ids)}`
          yield* sql`DELETE FROM forms WHERE entry_id IN ${sql.in(ids)}`
          yield* sql`DELETE FROM senses WHERE entry_id IN ${sql.in(ids)}`
          yield* sql`
          INSERT INTO entries ${sql.insert(
            entries.map((entry) => ({
              id: entry.id,
              headword: entry.headword,
              reading: entry.reading,
              common: entry.common,
              priority: entry.priority
            }))
          )}
          ON CONFLICT (id) DO UPDATE SET
            headword = excluded.headword,
            reading = excluded.reading,
            common = excluded.common,
            priority = excluded.priority
        `

          const forms = entries.flatMap((entry) => {
            const position = { kanji: 0, kana: 0 }
            return entry.forms.map((form) => ({
              entryId: entry.id,
              kind: form.kind,
              position: position[form.kind]++,
              text: form.text,
              common: form.common,
              tags: JSON.stringify(form.tags),
              priorities: JSON.stringify(form.priorities),
              restrictions: JSON.stringify(form.restrictions),
              noKanji: form.noKanji
            }))
          })
          for (const chunk of chunks(forms, 2000)) yield* sql`INSERT INTO forms ${sql.insert(chunk)}`

          const senses = entries.flatMap((entry) =>
            entry.senses.map((sense, position) => ({
              entryId: entry.id,
              position,
              glosses: JSON.stringify(sense.glosses),
              pos: JSON.stringify(sense.pos),
              misc: JSON.stringify(sense.misc),
              fields: JSON.stringify(sense.fields),
              dialects: JSON.stringify(sense.dialects),
              info: JSON.stringify(sense.info),
              stagk: JSON.stringify(sense.stagk),
              stagr: JSON.stringify(sense.stagr),
              xrefs: JSON.stringify(sense.xrefs),
              antonyms: JSON.stringify(sense.antonyms)
            }))
          )
          for (const chunk of chunks(senses, 1500)) yield* sql`INSERT INTO senses ${sql.insert(chunk)}`

          const glosses = entries.flatMap((entry) =>
            entry.senses.flatMap((sense, senseIndex) =>
              sense.glosses.map((gloss, position) => ({
                entryId: entry.id,
                sense: senseIndex,
                position,
                text: gloss.text,
                norm: normalizeGloss(gloss.text)
              }))
            )
          )
          for (const chunk of chunks(glosses, 4000)) yield* sql`INSERT INTO glosses ${sql.insert(chunk)}`
        },
        (effect) => sql.withTransaction(effect),
        Effect.orDie
      )

      const replaceTags = Effect.fn("DictionaryRepo.replaceTags")(
        function* (tags: ReadonlyArray<{ readonly code: string; readonly label: string }>) {
          yield* sql`DELETE FROM tags`
          for (const chunk of chunks(tags, 1000)) {
            yield* sql`INSERT INTO tags ${sql.insert(chunk.map((tag) => ({ code: tag.code, label: tag.label })))}`
          }
        },
        (effect) => sql.withTransaction(effect),
        Effect.orDie
      )

      const tags = sql`SELECT code, label FROM tags`.pipe(
        Effect.flatMap(decodeRows(TagRow)),
        Effect.map((rows) => new Map(rows.map((row) => [row.code, row.label]))),
        Effect.orDie
      )

      const count = sql`SELECT count(*) AS n FROM entries`.pipe(
        Effect.flatMap(decodeRows(CountRow)),
        Effect.map((rows) => rows[0]?.n ?? 0),
        Effect.orDie
      )

      const getEntries = Effect.fn("DictionaryRepo.getEntries")(function* (ids: ReadonlyArray<number>) {
        if (ids.length === 0) return []
        const entries = yield* sql`
          SELECT id, headword, reading, common, priority FROM entries WHERE id IN ${sql.in(ids)}
        `.pipe(Effect.flatMap(decodeRows(EntryRow)))
        const forms = yield* sql`
          SELECT entry_id, kind, text, common, tags, priorities, restrictions, no_kanji
          FROM forms WHERE entry_id IN ${sql.in(ids)}
          ORDER BY entry_id, kind DESC, position
        `.pipe(Effect.flatMap(decodeRows(FormRow)))
        const senses = yield* sql`
          SELECT entry_id, glosses, pos, misc, fields, dialects, info, stagk, stagr, xrefs, antonyms
          FROM senses WHERE entry_id IN ${sql.in(ids)}
          ORDER BY entry_id, position
        `.pipe(Effect.flatMap(decodeRows(SenseRow)))

        const byId = new Map(entries.map((entry) => [entry.id, entry]))
        return ids.flatMap((id): Array<EntryRecord> => {
          const entry = byId.get(id)
          if (entry === undefined) return []
          return [
            {
              ...entry,
              forms: forms.filter((form) => form.entryId === id).map(({ entryId: _, ...form }) => form),
              senses: senses.filter((sense) => sense.entryId === id).map(({ entryId: _, ...sense }) => sense)
            }
          ]
        })
      }, Effect.orDie)

      const findForms = Effect.fn("DictionaryRepo.findForms")(function* (texts: ReadonlyArray<string>) {
        if (texts.length === 0) return []
        return yield* sql`
          SELECT entry_id, text, kind FROM forms WHERE text IN ${sql.in(texts)}
        `.pipe(Effect.flatMap(decodeRows(FormMatch)))
      }, Effect.orDie)

      const findFormPrefix = Effect.fn("DictionaryRepo.findFormPrefix")(function* (prefix: string, limit: number) {
        const rows = yield* sql`
          SELECT f.entry_id AS id
          FROM forms f JOIN entries e ON e.id = f.entry_id
          WHERE f.text >= ${prefix} AND f.text < ${prefix + "\u{10FFFF}"}
          GROUP BY f.entry_id
          ORDER BY bool_or(e.common) DESC, max(e.priority) DESC, min(length(f.text))
          LIMIT ${limit}
        `.pipe(Effect.flatMap(decodeRows(IdRow)))
        return rows.map((row) => row.id)
      }, Effect.orDie)

      // `rank` is negated ts_rank so it keeps FTS5 bm25's shape: ascending order, more negative = better.
      const searchGlosses = Effect.fn("DictionaryRepo.searchGlosses")(function* (query: string, limit: number) {
        return yield* sql`
          SELECT g.entry_id, g.sense, g.position, g.text, -ts_rank(g.ts, query) AS rank,
            json_array_length(s.glosses::json) AS gloss_count, s.misc
          FROM plainto_tsquery('english', ${query}) AS query
          JOIN glosses g ON g.ts @@ query
          JOIN senses s ON s.entry_id = g.entry_id AND s.position = g.sense
          ORDER BY rank
          LIMIT ${limit}
        `.pipe(Effect.flatMap(decodeRows(GlossMatch)))
      }, Effect.orDie)

      const findGlossesExact = Effect.fn("DictionaryRepo.findGlossesExact")(function* (query: string, limit: number) {
        const norm = normalizeGloss(query)
        if (norm.length === 0) return []
        return yield* sql`
          SELECT g.entry_id, g.sense, g.position, g.text, 0 AS rank,
            json_array_length(s.glosses::json) AS gloss_count, s.misc
          FROM glosses g
          JOIN entries e ON e.id = g.entry_id
          JOIN senses s ON s.entry_id = g.entry_id AND s.position = g.sense
          WHERE g.norm = ${norm}
          ORDER BY e.common DESC, e.priority DESC
          LIMIT ${limit}
        `.pipe(Effect.flatMap(decodeRows(GlossMatch)))
      }, Effect.orDie)

      const sharedGlossCandidates = Effect.fn("DictionaryRepo.sharedGlossCandidates")(function* (
        entryId: number,
        sense: number,
        limit: number
      ) {
        return yield* sql`
            SELECT g2.entry_id, min(g2.sense) AS sense, min(g2.text) AS gloss
            FROM glosses g1
            JOIN glosses g2 ON g2.norm = g1.norm AND g2.entry_id != g1.entry_id
            JOIN entries e ON e.id = g2.entry_id
            WHERE g1.entry_id = ${entryId} AND g1.sense = ${sense} AND length(g1.norm) > 1
            GROUP BY g2.entry_id
            ORDER BY bool_or(e.common) DESC, max(e.priority) DESC
            LIMIT ${limit}
          `.pipe(Effect.flatMap(decodeRows(Candidate)))
      }, Effect.orDie)

      const ranks = Effect.fn("DictionaryRepo.ranks")(function* (ids: ReadonlyArray<number>) {
        if (ids.length === 0) return new Map<number, { common: boolean; priority: number }>()
        const rows = yield* sql`SELECT id, common, priority FROM entries WHERE id IN ${sql.in(ids)}`.pipe(
          Effect.flatMap(decodeRows(RankRow))
        )
        return new Map(rows.map((row) => [row.id, { common: row.common, priority: row.priority }]))
      }, Effect.orDie)

      const missingClause = (kind: EnrichmentKind) => {
        switch (kind) {
          case "nuance":
            return sql`NOT EXISTS (SELECT 1 FROM sense_nuance n WHERE n.entry_id = e.id)`
          case "examples":
            return sql`NOT EXISTS (SELECT 1 FROM examples x WHERE x.entry_id = e.id)`
          case "audio":
            return sql`NOT EXISTS (SELECT 1 FROM entry_audio a WHERE a.entry_id = e.id)`
        }
      }

      const entriesByPriority = Effect.fn("DictionaryRepo.entriesByPriority")(function* (query: PriorityQuery) {
        const clauses = [
          ...(query.commonOnly ? [sql`e.common`] : []),
          ...(query.missing ? [missingClause(query.missing)] : [])
        ]
        const rows = yield* sql`
          SELECT e.id FROM entries e
          WHERE ${clauses.length > 0 ? sql.and(clauses) : sql.literal("TRUE")}
          ORDER BY e.priority DESC, e.id
          LIMIT ${query.limit}
        `.pipe(Effect.flatMap(decodeRows(IdRow)))
        return rows.map((row) => row.id)
      }, Effect.orDie)

      return DictionaryRepo.of({
        insertEntries,
        replaceTags,
        tags,
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
