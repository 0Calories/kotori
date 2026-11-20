import {
  entries,
  type EntryBase,
  type EntryId,
  entrySearch,
  type Language,
  nullIfEmpty,
  type ReviewState
} from "@kotori/db"
import { cjkSearchTokens, normalizeGloss, normalizeJapaneseGloss } from "@kotori/language"
import { asc, gt, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { chunks } from "../../db/chunks.ts"
import type { DatabaseShape } from "../../db/Database.ts"

/** Minimal slice of an `entries` row needed to derive its `entry_search` projection. */
export interface SearchProjectionSource {
  readonly id: EntryId
  readonly language: Language
  readonly reviewState: ReviewState
  readonly redirectTo: EntryId | null
  readonly common: boolean
  readonly priority: number
  readonly base: EntryBase
}

export type EntrySearchInsert = typeof entrySearch.$inferInsert

/**
 * Projects one `entries` row into its `entry_search` rows purely from `entries.base` and
 * lifecycle scalars. Discarded entries and merged redirects (`redirectTo !== null`) are omitted
 * from search. `entries.enrichment` is never read.
 */
export const projectEntrySearch = (entry: SearchProjectionSource): Array<EntrySearchInsert> => {
  if (entry.reviewState === "discarded" || entry.redirectTo !== null) return []
  const shared = {
    entryId: entry.id,
    language: entry.language,
    reviewState: entry.reviewState,
    common: entry.common,
    priority: entry.priority
  } as const

  const rows: Array<EntrySearchInsert> = []
  for (const form of entry.base.forms) {
    rows.push({
      ...shared,
      kind: "form",
      formKind: form.kind,
      text: form.text,
      folded: entry.language === "en" ? form.text.toLowerCase() : null,
      norm: null,
      sense: null,
      position: null,
      glossCount: null,
      tags: nullIfEmpty(form.tags),
      misc: null,
      cjkTokens: null
    })
  }

  entry.base.senses.forEach((sense, senseIndex) => {
    const glossCount = sense.glosses.length
    const misc = nullIfEmpty(sense.misc)
    sense.glosses.forEach((gloss, position) => {
      const norm = entry.language === "ja" ? normalizeGloss(gloss.text) : normalizeJapaneseGloss(gloss.text)
      rows.push({
        ...shared,
        kind: "gloss",
        formKind: null,
        text: gloss.text,
        folded: null,
        norm,
        sense: senseIndex,
        position,
        glossCount,
        tags: null,
        misc,
        cjkTokens: entry.language === "en" ? nullIfEmpty(cjkSearchTokens(norm)) : null
      })
    })
  })

  return rows
}

type Tx = Parameters<Parameters<DatabaseShape["transaction"]>[0]>[0]

/** Replaces the `entry_search` projection rows for a batch of entries inside an active transaction. */
export const syncEntrySearch = Effect.fnUntraced(function* (tx: Tx, sources: ReadonlyArray<SearchProjectionSource>) {
  if (sources.length === 0) return
  const ids = sources.map((source) => source.id)
  for (const chunk of chunks(ids, 5000)) {
    yield* tx.delete(entrySearch).where(inArray(entrySearch.entryId, [...chunk]))
  }
  const rows = sources.flatMap(projectEntrySearch)
  for (const chunk of chunks(rows, 2000)) {
    yield* tx.insert(entrySearch).values([...chunk])
  }
})

export interface RebuildSearchSummary {
  readonly entries: number
  readonly indexedRows: number
}

/**
 * Drops and rebuilds the entire `entry_search` projection deterministically from `entries.base`
 * without re-downloading external Sources or touching `entries.enrichment`.
 */
export const rebuildEntrySearch = Effect.fn("dictionary.rebuildEntrySearch")(function* (
  db: DatabaseShape,
  options: { readonly batchSize?: number | undefined } = {}
) {
  const batchSize = options.batchSize ?? 1000
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(entrySearch)
      let after: EntryId | null = null
      let processedEntries = 0
      let indexedRows = 0
      while (true) {
        const page: ReadonlyArray<SearchProjectionSource> = yield* tx
          .select({
            id: entries.id,
            language: entries.language,
            reviewState: entries.reviewState,
            redirectTo: entries.redirectTo,
            common: entries.common,
            priority: entries.priority,
            base: entries.base
          })
          .from(entries)
          .where(after === null ? undefined : gt(entries.id, after))
          .orderBy(asc(entries.id))
          .limit(batchSize)
        if (page.length === 0) break
        after = page.at(-1)!.id
        processedEntries += page.length
        const rows = page.flatMap(projectEntrySearch)
        for (const chunk of chunks(rows, 2000)) {
          yield* tx.insert(entrySearch).values([...chunk])
        }
        indexedRows += rows.length
      }
      return { entries: processedEntries, indexedRows } satisfies RebuildSearchSummary
    })
  )
}, Effect.orDie)
