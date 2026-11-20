import type {
  Enrichment,
  EnrichmentStatus,
  Entry,
  EntryId,
  EntrySummary,
  Language,
  RateLimited,
  SearchResult
} from "@kotori/contracts"
import { type EntryReview, REVIEW_RULES, type UserId } from "@kotori/db"
import { Context, Effect, Layer, Match, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { assembleEntry } from "./entries.ts"
import { makeEnrichmentStatus } from "./enrichmentStatus.ts"
import { entryLanguage, getEntries } from "./queries.ts"
import { makeSearch } from "./search.ts"

export { audioUrl } from "./shared.ts"

const awaitingStatus = (status: EnrichmentStatus): EnrichmentStatus =>
  Match.value(status).pipe(
    Match.when("ready", () => "ready" as const),
    Match.when("queued", () => "queued" as const),
    Match.when(Match.is("unrequested", "unavailable"), () => "unavailable" as const),
    Match.exhaustive
  )

const awaitingApproval = (enrichment: Enrichment): Enrichment => ({
  examples: awaitingStatus(enrichment.examples),
  audio: awaitingStatus(enrichment.audio)
})

export class Dictionary extends Context.Service<
  Dictionary,
  {
    search(query: string, language: Language, limit: number): Effect.Effect<SearchResult>
    entry(id: EntryId): Effect.Effect<Option.Option<Entry>>
    enrichment(id: EntryId): Effect.Effect<Option.Option<Enrichment>>
    requestEnrichment(id: EntryId, requester: UserId): Effect.Effect<Option.Option<Enrichment>, RateLimited>
    summarize(ids: ReadonlyArray<EntryId>): Effect.Effect<ReadonlyArray<EntrySummary>>
    lookupWords(
      words: ReadonlyArray<{ readonly word: string; readonly reading: string }>,
      language: Language
    ): Effect.Effect<ReadonlyArray<EntryId | null>>
  }
>()("@kotori/backend/Dictionary") {
  static readonly layer = Layer.effect(
    Dictionary,
    Effect.gen(function* () {
      const db = yield* Database
      const { enrichmentOf, requestFor } = yield* makeEnrichmentStatus
      const { search, summarize, lookupWords } = makeSearch(db)

      const statusOf = (entry: { readonly id: EntryId; readonly language: Language; readonly review: EntryReview }) =>
        REVIEW_RULES[entry.review].inDictionary
          ? enrichmentOf(entry)
          : Effect.map(enrichmentOf(entry), awaitingApproval)

      const entry = Effect.fn("Dictionary.entry")(function* (id: EntryId) {
        const [record] = yield* getEntries(db, [id])
        return record === undefined ? Option.none() : Option.some(yield* assembleEntry(db, record, statusOf(record)))
      })

      const enrichment = Effect.fn("Dictionary.enrichment")(function* (id: EntryId) {
        const found = yield* entryLanguage(db, id)
        return found === undefined ? Option.none() : Option.some(yield* statusOf(found))
      })

      const requestEnrichment = Effect.fn("Dictionary.requestEnrichment")(function* (id: EntryId, requester: UserId) {
        const found = yield* entryLanguage(db, id)
        if (found === undefined) return Option.none()
        return Option.some(
          yield* REVIEW_RULES[found.review].inDictionary ? requestFor(found, requester) : statusOf(found)
        )
      })

      return Dictionary.of({ search, entry, enrichment, requestEnrichment, summarize, lookupWords })
    })
  )
}
