import type { Entry, EntryId, EntrySummary, Language, SearchResult } from "@kotori/contracts"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "../../db/Database.ts"
import { assembleEntry } from "./entries.ts"
import { getEntryDocuments } from "./queries.ts"
import { makeSearch } from "./search.ts"

export { audioUrl } from "./shared.ts"

export class Dictionary extends Context.Service<
  Dictionary,
  {
    /** Searches the dictionary of `language`: Japanese words for Japanese learners, English ones for English learners. */
    search(query: string, language: Language, limit: number): Effect.Effect<SearchResult>
    /** An entry as the app shows it, assembled from Source facts and any manually added enrichment. */
    entry(id: EntryId): Effect.Effect<Option.Option<Entry>>
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
      const { search, summarize, lookupWords } = makeSearch(db)

      const entry = Effect.fn("Dictionary.entry")(function* (id: EntryId) {
        let currentId = id
        for (let hop = 0; hop < 5; hop++) {
          const [doc] = yield* getEntryDocuments(db, [currentId])
          if (doc === undefined) return Option.none()
          if (doc.redirectTo === null) return Option.some(yield* assembleEntry(db, doc))
          currentId = doc.redirectTo
        }
        return Option.none()
      })

      return Dictionary.of({ search, entry, summarize, lookupWords })
    })
  )
}
