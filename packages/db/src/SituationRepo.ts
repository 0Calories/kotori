import { SqliteClient } from "@effect/sql-sqlite-node"
import { Context, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import * as sqliteVec from "sqlite-vec"
import { rankByCosine, type VectorHit } from "./fusion.ts"

const DIM = 384

export interface SituationPhrase {
  readonly ja: string
  readonly reading: string
  readonly en: string
  readonly formality: string
}

export interface SituationEmbedding {
  readonly text: string
  readonly vector: Float32Array
}

export interface SituationInput {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly note: string
  readonly aliases: readonly string[]
  readonly phrases: readonly SituationPhrase[]
  readonly entryIds: readonly number[]
  readonly embeddings: readonly SituationEmbedding[]
}

export interface SituationRecord {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly note: string
  readonly aliases: readonly string[]
  readonly phrases: readonly SituationPhrase[]
  readonly entryIds: readonly number[]
}

const vectorBlob = (vector: Float32Array) => {
  const copy = new Uint8Array(vector.byteLength)
  copy.set(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength))
  return copy
}

const blobVector = (blob: Uint8Array) => {
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}

const FtsRow = Schema.Struct({ situationId: Schema.String, rank: Schema.Number })
const VecRow = Schema.Struct({ situationId: Schema.String, distance: Schema.Number })
const AliasRow = Schema.Struct({ situationId: Schema.String, text: Schema.String })
const PhraseRow = Schema.Struct({
  situationId: Schema.String,
  ja: Schema.String,
  reading: Schema.String,
  en: Schema.String,
  formality: Schema.String
})
const EntryLinkRow = Schema.Struct({ situationId: Schema.String, entryId: Schema.Int })
const SituationRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: Schema.String,
  note: Schema.String
})
const EmbeddingRow = Schema.Struct({ situationId: Schema.String, embedding: Schema.Uint8Array })
const CountRow = Schema.Struct({ n: Schema.Int })

const decodeRows = <S extends Schema.Constraint>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

const chunks = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/

export class SituationRepo extends Context.Service<SituationRepo, {
  replaceAll(situations: ReadonlyArray<SituationInput>): Effect.Effect<void>
  readonly count: Effect.Effect<number>
  readonly vectorBackend: Effect.Effect<"sqlite-vec" | "blob">
  /** Best-first situation ids for an FTS5 MATCH expression over English text. */
  searchKeyword(match: string, limit: number): Effect.Effect<ReadonlyArray<string>>
  /** Best-first situation ids for a Japanese substring. */
  searchJapanese(fragment: string, limit: number): Effect.Effect<ReadonlyArray<string>>
  searchVector(vector: Float32Array, limit: number): Effect.Effect<ReadonlyArray<VectorHit>>
  getMany(ids: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<SituationRecord>>
  readonly all: Effect.Effect<ReadonlyArray<SituationRecord>>
  logMiss(query: string, topScore: number | null, topId: string | null): Effect.Effect<void>
}>()("@kotori/db/SituationRepo") {
  static readonly layer = Layer.effect(
    SituationRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const sqlite = yield* SqliteClient.SqliteClient

      const backend = yield* Effect.cached(Effect.gen(function*() {
        yield* sqlite.loadExtension(sqliteVec.getLoadablePath())
        yield* sql`
          CREATE VIRTUAL TABLE IF NOT EXISTS situation_vec USING vec0(
            embedding float[384] distance_metric=cosine,
            +situation_id text
          )
        `
        return "sqlite-vec" as const
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("sqlite-vec unavailable; scanning embedding blobs", cause).pipe(
            Effect.as("blob" as const)
          )
        )
      ))

      const indexedText = (situation: SituationInput) => {
        const texts = [situation.title, ...situation.aliases, ...situation.phrases.map((phrase) => phrase.en)]
        return [...new Set(texts.map((text) => text.trim()).filter((text) => text.length > 0 && /[A-Za-z]/.test(text)))]
      }

      const write = (situations: ReadonlyArray<SituationInput>, kind: "sqlite-vec" | "blob") =>
        Effect.gen(function*() {
          yield* sql`DELETE FROM situation_fts`
          if (kind === "sqlite-vec") yield* sql`DELETE FROM situation_vec`
        yield* sql`DELETE FROM situations`

        if (situations.length === 0) return

        for (const chunk of chunks([...situations], 200)) {
          yield* sql`INSERT INTO situations ${
            sql.insert(chunk.map((situation) => ({
              id: situation.id,
              title: situation.title,
              category: situation.category,
              note: situation.note
            })))
          }`
        }

        const aliases = situations.flatMap((situation) =>
          situation.aliases.map((text, position) => ({ situationId: situation.id, position, text }))
        )
        for (const chunk of chunks(aliases, 400)) {
          yield* sql`INSERT INTO situation_aliases ${sql.insert(chunk)}`
        }

        const phrases = situations.flatMap((situation) =>
          situation.phrases.map((phrase, position) => ({
            situationId: situation.id,
            position,
            ja: phrase.ja,
            reading: phrase.reading,
            en: phrase.en,
            formality: phrase.formality
          }))
        )
        for (const chunk of chunks(phrases, 400)) {
          yield* sql`INSERT INTO situation_phrases ${sql.insert(chunk)}`
        }

        const links = situations.flatMap((situation) =>
          situation.entryIds.map((entryId, position) => ({ situationId: situation.id, position, entryId }))
        )
        for (const chunk of chunks(links, 400)) {
          yield* sql`INSERT INTO situation_entries ${sql.insert(chunk)}`
        }

        const embeddings = situations.flatMap((situation) =>
          situation.embeddings.map((embedding) => ({
            situationId: situation.id,
            text: embedding.text,
            embedding: vectorBlob(embedding.vector)
          }))
        )
        for (const chunk of chunks(embeddings, 200)) {
          yield* sql`INSERT INTO situation_embeddings ${sql.insert(chunk)}`
        }

        const fts = situations.flatMap((situation) =>
          indexedText(situation).map((text) => ({ situationId: situation.id, text }))
        )
        for (const chunk of chunks(fts, 400)) {
          yield* sql`INSERT INTO situation_fts ${sql.insert(chunk)}`
        }

        if (kind === "sqlite-vec") {
          for (const row of embeddings) {
            if (row.embedding.byteLength !== DIM * 4) {
              return yield* Effect.die(`embedding for ${row.situationId} is not ${DIM}-d`)
            }
            yield* sql`INSERT INTO situation_vec (embedding, situation_id) VALUES (${row.embedding}, ${row.situationId})`
          }
        }
        })

      // Create the vec0 table outside the write transaction. A virtual table
      // created inside a transaction that later rolls back would leave the
      // cached backend pointing at a table that no longer exists.
      const replaceAll = Effect.fn("SituationRepo.replaceAll")(function*(situations: ReadonlyArray<SituationInput>) {
        const kind = yield* backend
        yield* sql.withTransaction(write(situations, kind))
      }, Effect.orDie)

      const count = sql`SELECT count(*) AS n FROM situations`.pipe(
        Effect.flatMap(decodeRows(CountRow)),
        Effect.map((rows) => rows[0]?.n ?? 0),
        Effect.orDie
      )

      const searchKeyword = Effect.fn("SituationRepo.searchKeyword")(function*(match: string, limit: number) {
        if (match.trim().length === 0) return []
        const rows = yield* sql`
          SELECT situation_id, bm25(situation_fts) AS rank
          FROM situation_fts
          WHERE situation_fts MATCH ${match}
          ORDER BY rank
          LIMIT 500
        `.pipe(Effect.flatMap(decodeRows(FtsRow)))
        const best = new Map<string, number>()
        for (const row of rows) {
          const current = best.get(row.situationId)
          if (current === undefined || row.rank < current) best.set(row.situationId, row.rank)
        }
        return [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id]) => id)
      }, Effect.orDie)

      const searchJapanese = Effect.fn("SituationRepo.searchJapanese")(function*(fragment: string, limit: number) {
        const query = fragment.normalize("NFKC").trim()
        if (query.length < 2 || !JAPANESE.test(query)) return []
        const aliases = yield* sql`SELECT situation_id, text FROM situation_aliases`.pipe(
          Effect.flatMap(decodeRows(AliasRow))
        )
        const phrases = yield* sql`SELECT situation_id, ja AS text FROM situation_phrases`.pipe(
          Effect.flatMap(decodeRows(AliasRow))
        )
        const readings = yield* sql`SELECT situation_id, reading AS text FROM situation_phrases`.pipe(
          Effect.flatMap(decodeRows(AliasRow))
        )
        const best = new Map<string, number>()
        for (const row of [...aliases, ...phrases, ...readings]) {
          const text = row.text
          let score: number | null = null
          if (text === query) score = 0
          else if (text.includes(query)) score = 10 + text.length / 100
          else if (query.length >= 4 && text.length >= 4 && query.includes(text)) score = 20 + text.length / 100
          if (score === null) continue
          const current = best.get(row.situationId)
          if (current === undefined || score < current) best.set(row.situationId, score)
        }
        return [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([id]) => id)
      }, Effect.orDie)

      const scanBlobs = Effect.fnUntraced(function*(vector: Float32Array, limit: number) {
        const rows = yield* sql`SELECT situation_id, embedding FROM situation_embeddings`.pipe(
          Effect.flatMap(decodeRows(EmbeddingRow))
        )
        return rankByCosine(
          vector,
          rows.map((row) => ({ id: row.situationId, vector: blobVector(row.embedding) })),
          limit
        )
      })

      const searchVector = Effect.fn("SituationRepo.searchVector")(function*(vector: Float32Array, limit: number) {
        const kind = yield* backend
        if (kind === "sqlite-vec") {
          const k = Math.min(400, Math.max(limit * 12, 40))
          const blob = vectorBlob(vector)
          const rows = yield* sql`
            SELECT situation_id, distance
            FROM situation_vec
            WHERE embedding MATCH ${blob} AND k = ${sql.literal(String(k))}
          `.pipe(
            Effect.flatMap(decodeRows(VecRow)),
            Effect.tapError((cause) => Effect.logWarning("sqlite-vec query failed", cause)),
            Effect.option
          )
          if (rows._tag === "Some") {
            return dedupeVector(rows.value.map((row) => ({
              id: row.situationId,
              cosine: 1 - row.distance
            })), limit)
          }
        }
        return yield* scanBlobs(vector, limit)
      }, Effect.orDie)

      const load = Effect.fnUntraced(function*(ids: ReadonlyArray<string> | null) {
        const situations = yield* (ids === null
          ? sql`SELECT id, title, category, note FROM situations ORDER BY id`
          : ids.length === 0
          ? Effect.succeed([])
          : sql`SELECT id, title, category, note FROM situations WHERE id IN ${sql.in(ids)}`).pipe(
            Effect.flatMap(decodeRows(SituationRow))
          )
        const wanted = ids ?? situations.map((situation) => situation.id)
        if (wanted.length === 0) return []
        const aliases = yield* sql`
          SELECT situation_id, text FROM situation_aliases
          WHERE situation_id IN ${sql.in(wanted)}
          ORDER BY situation_id, position
        `.pipe(Effect.flatMap(decodeRows(AliasRow)))
        const phrases = yield* sql`
          SELECT situation_id, ja, reading, en, formality FROM situation_phrases
          WHERE situation_id IN ${sql.in(wanted)}
          ORDER BY situation_id, position
        `.pipe(Effect.flatMap(decodeRows(PhraseRow)))
        const links = yield* sql`
          SELECT situation_id, entry_id FROM situation_entries
          WHERE situation_id IN ${sql.in(wanted)}
          ORDER BY situation_id, position
        `.pipe(Effect.flatMap(decodeRows(EntryLinkRow)))
        const byId = new Map(situations.map((situation) => [situation.id, situation]))
        return wanted.flatMap((id): SituationRecord[] => {
          const situation = byId.get(id)
          if (situation === undefined) return []
          return [{
            ...situation,
            aliases: aliases.filter((row) => row.situationId === id).map((row) => row.text),
            phrases: phrases.filter((row) => row.situationId === id).map(({ situationId: _, ...phrase }) => phrase),
            entryIds: links.filter((row) => row.situationId === id).map((row) => row.entryId)
          }]
        })
      }, Effect.orDie)

      const logMiss = Effect.fn("SituationRepo.logMiss")(
        function*(query: string, topScore: number | null, topId: string | null) {
          yield* sql`
            INSERT INTO situation_misses (query, top_score, top_id, created_at)
            VALUES (${query}, ${topScore}, ${topId}, ${Date.now()})
          `
        },
        Effect.orDie
      )

      return SituationRepo.of({
        replaceAll,
        count,
        vectorBackend: backend,
        searchKeyword,
        searchJapanese,
        searchVector,
        getMany: (ids) => load(ids),
        all: load(null),
        logMiss
      })
    })
  )
}

const dedupeVector = (hits: readonly VectorHit[], limit: number): VectorHit[] => {
  const best = new Map<string, number>()
  for (const hit of hits) {
    const current = best.get(hit.id)
    if (current === undefined || hit.cosine > current) best.set(hit.id, hit.cosine)
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, score]) => ({ id, cosine: score }))
}
