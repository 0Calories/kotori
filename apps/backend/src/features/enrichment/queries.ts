import { type Casting, type EntryId, examples, type Formality } from "@kotori/db"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

export type ExampleInput = Omit<typeof examples.$inferInsert, "id" | "entryId" | "position" | "createdAt">

export const saveExamples = Effect.fn("enrichment.saveExamples")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  rows: ReadonlyArray<ExampleInput>,
  now: Date
) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
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
    // Postgres orders false before true, placing source = 'kotori' first.
    .orderBy(examples.entryId, examples.sense, sql`${examples.source} <> 'kotori'`, examples.position)
}, Effect.orDie)

export interface JudgedExample {
  readonly id: number
  readonly formality: Formality
  readonly casting: Casting
}

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

// Stored alongside formality = null to distinguish sentences Jev declined to score from unjudged sentences (casting = null).
export const DECLINED_CASTING: Casting = {
  speakerGender: "unspecified",
  speakerAge: "unspecified",
  medium: null,
  variety: null,
  tone: null
}

export const judgedCasting = (example: { readonly formality: Formality | null; readonly casting: Casting | null }) =>
  example.formality !== null || example.casting !== null

export const declineCasting = Effect.fn("enrichment.declineCasting")(function* (
  db: DatabaseShape,
  ids: ReadonlyArray<number>
) {
  if (ids.length === 0) return
  yield* db
    .update(examples)
    .set({ casting: DECLINED_CASTING })
    .where(and(inArray(examples.id, [...ids]), isNull(examples.formality), isNull(examples.casting)))
}, Effect.orDie)

export type ExampleRow = Effect.Success<ReturnType<typeof examplesFor>>[number]
