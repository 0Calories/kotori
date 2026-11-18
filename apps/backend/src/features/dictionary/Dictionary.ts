import type { Enrichment, Entry, EntryId, EntrySummary, Language, RateLimited, SearchResult } from "@kotori/contracts"
import type { UserId } from "@kotori/db"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { assembleEntry } from "./entries.ts"
import { makeEnrichmentStatus } from "./enrichmentStatus.ts"
import { entryLanguage, getEntries } from "./queries.ts"
import { makeSearch } from "./search.ts"

export { audioUrl } from "./shared.ts"

export class Dictionary extends Context.Service<
  Dictionary,
  {
    /** Searches the dictionary of `language`: Japanese words for Japanese learners, English ones for English learners. */
    search(query: string, language: Language, limit: number): Effect.Effect<SearchResult>
    /** An entry as the app shows it, with its enrichment status. Reads only; never queues work. */
    entry(id: EntryId): Effect.Effect<Option.Option<Entry>>
    /** Whether an entry's example sentences and audio are ready yet. Reads only; never queues work. */
    enrichment(id: EntryId): Effect.Effect<Option.Option<Enrichment>>
    /**
     * Queues whatever enrichment an entry is missing, returning its status. Queuing its example
     * sentences takes one of the requester's allowance; fails, queuing nothing, once it's used up.
     */
    requestEnrichment(id: EntryId, requester: UserId): Effect.Effect<Option.Option<Enrichment>, RateLimited>
    /** Search-result summaries for known entries, for Ask Kotori's links. */
    summarize(ids: ReadonlyArray<EntryId>): Effect.Effect<ReadonlyArray<EntrySummary>>
    /** Entry ids for words in `language`, for linking coach vocabulary to the dictionary. */
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

      const entry = Effect.fn("Dictionary.entry")(function* (id: EntryId) {
        const [record] = yield* getEntries(db, [id])
        return record === undefined
          ? Option.none()
          : Option.some(yield* assembleEntry(db, record, enrichmentOf(record)))
      })

      const enrichment = Effect.fn("Dictionary.enrichment")(function* (id: EntryId) {
        const found = yield* entryLanguage(db, id)
        return found === undefined ? Option.none() : Option.some(yield* enrichmentOf(found))
      })

      const requestEnrichment = Effect.fn("Dictionary.requestEnrichment")(function* (id: EntryId, requester: UserId) {
        const found = yield* entryLanguage(db, id)
        return found === undefined ? Option.none() : Option.some(yield* requestFor(found, requester))
      })

      return Dictionary.of({ search, entry, enrichment, requestEnrichment, summarize, lookupWords })
    })
  )
}
