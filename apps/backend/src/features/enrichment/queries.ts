import {
  type Casting,
  entries,
  type EnrichedExample,
  type EntryEnrichment,
  type EntryId,
  type Formality,
  type Source
} from "@kotori/db"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

/** An AI-written example sentence as passed to `saveExamples`. */
export interface ExampleInput {
  readonly sense: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality | null
  readonly note: string | null
  readonly noteJa?: string | null | undefined
  readonly casting?: Casting | null | undefined
  readonly source?: Source | undefined
  readonly model: string | null
}

/** Replaces Kotori's AI-written example sentences inside `entries.enrichment.examples`. */
export const saveExamples = Effect.fn("enrichment.saveExamples")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  rows: ReadonlyArray<ExampleInput>,
  now: Date
) {
  const [doc] = yield* db.select({ enrichment: entries.enrichment }).from(entries).where(eq(entries.id, entryId))
  if (doc === undefined) return
  const examples: Array<EnrichedExample> = rows.map((row) => ({
    sense: row.sense,
    ja: row.ja,
    furigana: row.furigana,
    en: row.en,
    formality: row.formality,
    note: row.note,
    noteJa: row.noteJa ?? null,
    casting: row.casting ?? null,
    source: row.source ?? "kotori",
    model: row.model,
    createdAt: now.toISOString()
  }))
  const next: EntryEnrichment = { ...doc.enrichment, examples }
  yield* db.update(entries).set({ enrichment: next, updatedAt: now }).where(eq(entries.id, entryId))
}, Effect.orDie)

/**
 * Resets `entries.enrichment` to `NULL` instantaneously across all entries (or targeted `entryIds`)
 * without touching `entries.base`, `entry_search`, or content-addressed pronunciation `audio`.
 */
export const wipeEnrichment = Effect.fn("enrichment.wipeEnrichment")(function* (
  db: DatabaseShape,
  entryIds?: ReadonlyArray<EntryId>
) {
  const scoped = entryIds !== undefined && entryIds.length > 0 ? [...entryIds] : null
  const updated = yield* db
    .update(entries)
    .set({ enrichment: null, updatedAt: new Date() })
    .where(and(isNotNull(entries.enrichment), scoped === null ? undefined : inArray(entries.id, scoped)))
    .returning({ id: entries.id })
  return { entriesCleared: updated.length }
}, Effect.orDie)
