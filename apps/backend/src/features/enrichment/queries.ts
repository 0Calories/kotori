import { type Casting, type EntryId, examples, type Formality } from "@kotori/db"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
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
      // Audio links cascade from the examples.
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

/** A seeded sentence's judged casting signals. */
export interface JudgedExample {
  readonly id: number
  readonly formality: Formality
  readonly casting: Casting
}

/**
 * Saves the formality and casting judged for sentences that had none. A sentence judged in the
 * meantime keeps its own: what is set is never overwritten.
 */
export const saveCasting = Effect.fn("enrichment.saveCasting")(function* (
  db: DatabaseShape,
  rows: ReadonlyArray<JudgedExample>
) {
  if (rows.length === 0) return
  yield* db.transaction((tx) =>
    Effect.forEach(
      rows,
      (row) =>
        tx
          .update(examples)
          .set({ formality: row.formality, casting: row.casting })
          .where(and(eq(examples.id, row.id), isNull(examples.formality))),
      { discard: true }
    )
  )
}, Effect.orDie)

/** An example sentence as stored, with the formality and casting signals voice casting reads. */
export type ExampleRow = Effect.Success<ReturnType<typeof examplesFor>>[number]
