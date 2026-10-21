import {
  DictionaryRepo,
  englishFtsMatch,
  fuse,
  SCORE_THRESHOLD,
  SituationRepo,
  type VectorHit
} from "@kotori/db"
import { EntryId, type Formality, type SituationSearchResult } from "@kotori/domain"
import { hasJapanese } from "@kotori/japanese"
import { Context, Effect, Layer } from "effect"
import { Dictionary } from "./Dictionary.ts"

const RETRIEVE = 20

const FORMALITIES = new Set<Formality>(["vulgar", "casual", "neutral", "polite", "formal"])

const formalityOf = (value: string): Formality => (FORMALITIES.has(value as Formality) ? value as Formality : "neutral")

const embed = (text: string) =>
  Effect.flatMap(
    Effect.promise(() => import("@kotori/db/embedder")),
    (mod) => mod.embedQuery(text)
  )

export class Situations extends Context.Service<Situations, {
  readonly threshold: number
  keyword(query: string): Effect.Effect<ReadonlyArray<string>>
  vector(query: string): Effect.Effect<ReadonlyArray<VectorHit>>
  search(query: string, limit: number): Effect.Effect<SituationSearchResult>
}>()("@kotori/api/Situations") {
  static readonly layer = Layer.effect(
    Situations,
    Effect.gen(function*() {
      const repo = yield* SituationRepo
      const dictionary = yield* Dictionary
      const entries = yield* DictionaryRepo

      const keyword = Effect.fn("Situations.keyword")(function*(raw: string) {
        const query = raw.normalize("NFKC").trim()
        const match = englishFtsMatch(query)
        const fts = match === null ? [] : yield* repo.searchKeyword(match, RETRIEVE)
        const japanese = hasJapanese(query) ? yield* repo.searchJapanese(query, RETRIEVE) : []
        const ids = [...fts]
        for (const id of japanese) if (!ids.includes(id)) ids.push(id)
        return ids
      })

      const vector = Effect.fn("Situations.vector")(function*(raw: string) {
        const query = raw.normalize("NFKC").trim()
        if (query.length === 0) return []
        const embedded = yield* embed(query).pipe(
          Effect.catch((cause) => Effect.logWarning("situation embedding failed", cause).pipe(Effect.as(null)))
        )
        return embedded === null ? [] : yield* repo.searchVector(embedded, RETRIEVE)
      })

      const search = Effect.fn("Situations.search")(function*(raw: string, limit: number) {
        const query = raw.normalize("NFKC").trim()
        const capped = Math.min(Math.max(limit, 1), 20)
        const backend = yield* repo.vectorBackend
        if (query.length === 0) {
          return {
            query,
            fallback: true,
            threshold: SCORE_THRESHOLD,
            vector: backend,
            situations: [],
            dictionary: { query, mode: "english" as const, reading: null, entries: [] }
          }
        }

        const [dictionaryResult, keywordIds, vectorHits, indexed] = yield* Effect.all([
          dictionary.search(query, capped),
          keyword(query),
          vector(query),
          repo.count
        ], { concurrency: "unbounded" })

        const fused = fuse(keywordIds, vectorHits)
        const top = fused[0]
        const fallback = top === undefined || top.score < SCORE_THRESHOLD
        if (fallback && indexed > 0) yield* repo.logMiss(query, top?.score ?? null, top?.id ?? null)

        const chosen = fused.slice(0, capped)
        const records = yield* repo.getMany(chosen.map((hit) => hit.id))
        const byId = new Map(records.map((record) => [record.id, record]))
        const linked = yield* entries.getEntries([...new Set(records.flatMap((record) => [...record.entryIds]))])
        const entryById = new Map(linked.map((entry) => [entry.id, entry]))

        return {
          query,
          fallback,
          threshold: SCORE_THRESHOLD,
          vector: backend,
          dictionary: dictionaryResult,
          situations: chosen.flatMap((hit) => {
            const record = byId.get(hit.id)
            if (record === undefined) return []
            return [{
              id: record.id,
              title: record.title,
              category: record.category,
              note: record.note,
              score: hit.score,
              keywordRank: hit.keywordRank,
              vectorRank: hit.vectorRank,
              cosine: hit.cosine,
              phrases: record.phrases.map((phrase) => ({ ...phrase, formality: formalityOf(phrase.formality) })),
              entries: record.entryIds.flatMap((id) => {
                const entry = entryById.get(id)
                if (entry === undefined) return []
                return [{
                  id: EntryId.make(entry.id),
                  headword: entry.headword,
                  reading: entry.reading,
                  meanings: entry.senses[0]?.glosses.slice(0, 3).map((gloss) => gloss.text) ?? []
                }]
              })
            }]
          })
        }
      })

      return Situations.of({ threshold: SCORE_THRESHOLD, keyword, vector, search })
    })
  )
}
