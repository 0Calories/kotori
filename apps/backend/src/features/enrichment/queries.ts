import { cautions, entries, type EntryId, examples, labels, loanLinks, usagePatterns } from "@kotori/db"
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

// What the AI providers wrote about dictionary entries: example sentences, keyed by entry and
// sense. Kotori's are replaced whole on re-enrichment, and rebuildable.

/** An example sentence as written; positions are numbered per sense on save. */
export type ExampleInput = Omit<typeof examples.$inferInsert, "id" | "entryId" | "position" | "createdAt">

export const saveExamples = Effect.fn("enrichment.saveExamples")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  rows: ReadonlyArray<ExampleInput>,
  now: Date
) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      // Only Kotori's own: the sentences seeded from Tatoeba and Wiktionary are the import's.
      yield* tx.delete(examples).where(and(eq(examples.entryId, entryId), eq(examples.source, "kotori")))
      if (rows.length === 0) return
      const position = new Map<number, number>()
      yield* tx.insert(examples).values(
        rows.map((row) => {
          const next = position.get(row.sense) ?? 0
          position.set(row.sense, next + 1)
          return { entryId, position: next, createdAt: now, ...row }
        })
      )
    })
  )
}, Effect.orDie)

export const examplesFor = Effect.fn("enrichment.examplesFor")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  if (entryIds.length === 0) return []
  return yield* db
    .select({
      id: examples.id,
      entryId: examples.entryId,
      sense: examples.sense,
      position: examples.position,
      ja: examples.ja,
      furigana: examples.furigana,
      en: examples.en,
      formality: examples.formality,
      note: examples.note,
      noteJa: examples.noteJa,
      casting: examples.casting,
      source: examples.source,
      model: examples.model,
      createdAt: examples.createdAt
    })
    .from(examples)
    .where(inArray(examples.entryId, entryIds))
    // Kotori's sentences, written for learners, before the ones seeded from Tatoeba and Wiktionary.
    .orderBy(examples.entryId, examples.sense, sql`${examples.source} <> 'kotori'`, examples.position)
}, Effect.orDie)

/** Counts of AI enrichment rows removed or cleared by `wipeEnrichment`. */
export interface WipeSummary {
  readonly examples: number
  readonly seededCastingCleared: number
  readonly cautions: number
  readonly labels: number
  readonly usagePatterns: number
  readonly loanLinksDeleted: number
  readonly loanVerdictsCleared: number
}

/**
 * Clears all AI enrichment across the dictionary (or for specific `entryIds`) in one transaction
 * without touching external Source facts, Kotori-sourced entries' own facts, or spoken Form audio.
 */
export const wipeEnrichment = Effect.fn("enrichment.wipeEnrichment")(function* (
  db: DatabaseShape,
  entryIds?: ReadonlyArray<EntryId>
) {
  const scoped = entryIds !== undefined && entryIds.length > 0 ? [...entryIds] : null
  return yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const nonKotoriEntries = tx
        .select({ id: entries.id })
        .from(entries)
        .where(and(ne(entries.source, "kotori"), scoped === null ? undefined : inArray(entries.id, scoped)))

      const deletedExamples = yield* tx
        .delete(examples)
        .where(and(eq(examples.source, "kotori"), scoped === null ? undefined : inArray(examples.entryId, scoped)))
        .returning({ id: examples.id })

      const clearedCasting = yield* tx
        .update(examples)
        .set({ formality: null, casting: null })
        .where(
          and(
            or(isNotNull(examples.formality), isNotNull(examples.casting)),
            scoped === null ? undefined : inArray(examples.entryId, scoped)
          )
        )
        .returning({ id: examples.id })

      const deletedCautions = yield* tx
        .delete(cautions)
        .where(and(eq(cautions.source, "kotori"), inArray(cautions.entryId, nonKotoriEntries)))
        .returning({ id: cautions.id })

      const deletedLabels = yield* tx
        .delete(labels)
        .where(and(eq(labels.source, "kotori"), inArray(labels.entryId, nonKotoriEntries)))
        .returning({ entryId: labels.entryId })

      const deletedUsagePatterns = yield* tx
        .delete(usagePatterns)
        .where(and(eq(usagePatterns.source, "kotori"), inArray(usagePatterns.entryId, nonKotoriEntries)))
        .returning({ id: usagePatterns.id })

      const loanScope =
        scoped === null
          ? undefined
          : or(inArray(loanLinks.katakanaEntryId, scoped), inArray(loanLinks.englishEntryId, scoped))

      const deletedLoans = yield* tx
        .delete(loanLinks)
        .where(and(eq(loanLinks.source, "kotori"), loanScope))
        .returning({ id: loanLinks.id })

      const clearedVerdicts = yield* tx
        .update(loanLinks)
        .set({ meaning: null, meaningSource: null })
        .where(and(eq(loanLinks.meaningSource, "kotori"), loanScope))
        .returning({ id: loanLinks.id })

      return {
        examples: deletedExamples.length,
        seededCastingCleared: clearedCasting.length,
        cautions: deletedCautions.length,
        labels: deletedLabels.length,
        usagePatterns: deletedUsagePatterns.length,
        loanLinksDeleted: deletedLoans.length,
        loanVerdictsCleared: clearedVerdicts.length
      } satisfies WipeSummary
    })
  )
}, Effect.orDie)

/** An example sentence as stored. */
export type ExampleRow = Effect.Success<ReturnType<typeof examplesFor>>[number]
