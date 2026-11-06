import {
  entries,
  type EntryId,
  examples,
  type Language,
  type LoanVerdict,
  loanWords,
  type Nuance,
  senseNotes,
  senseNuance,
  similarWords
} from "@kotori/db"
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"

// What the AI providers wrote about dictionary entries: nuance and similar words per sense, an
// English word's katakana loan, usage notes and example sentences. Keyed by entry and sense,
// replaced whole on re-enrichment, and rebuildable.

/** A sense's judgment as saved: the interpretation, the raw answers it came from, and who judged it. */
export type NuanceInput = Omit<typeof senseNuance.$inferInsert, "entryId" | "createdAt">
/** An English word's loan verdict as saved, with the answers and candidates it came from. */
export type LoanWordInput = Pick<
  typeof loanWords.$inferInsert,
  "word" | "verdict" | "answers" | "model" | "questionsVersion"
>
export type SimilarInput = Omit<typeof similarWords.$inferInsert, "entryId">
/** An example sentence as written; positions are numbered per sense on save. */
export type ExampleInput = Omit<typeof examples.$inferInsert, "id" | "entryId" | "position" | "createdAt">
export type SenseNoteInput = Omit<typeof senseNotes.$inferInsert, "entryId" | "createdAt">

export const saveNuance = Effect.fn("enrichment.saveNuance")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  rows: ReadonlyArray<NuanceInput>,
  now: Date
) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(senseNuance).where(eq(senseNuance.entryId, entryId))
      if (rows.length === 0) return
      yield* tx.insert(senseNuance).values(
        rows.map((row) => ({
          entryId,
          sense: row.sense,
          nuance: row.nuance,
          answers: row.answers,
          model: row.model,
          questionsVersion: row.questionsVersion,
          createdAt: now
        }))
      )
    })
  )
}, Effect.orDie)

export const nuanceFor = Effect.fn("enrichment.nuanceFor")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  if (entryIds.length === 0) return []
  return yield* db
    .select({
      entryId: senseNuance.entryId,
      sense: senseNuance.sense,
      nuance: senseNuance.nuance,
      model: senseNuance.model,
      questionsVersion: senseNuance.questionsVersion
    })
    .from(senseNuance)
    .where(inArray(senseNuance.entryId, entryIds))
}, Effect.orDie)

/** Every entry holding stored nuance, in one dictionary or both, for reinterpretation sweeps. */
export const nuanceEntryIds = Effect.fn("enrichment.nuanceEntryIds")(function* (
  db: DatabaseShape,
  language?: Language
) {
  const rows = yield* db
    .selectDistinct({ entryId: senseNuance.entryId })
    .from(senseNuance)
    .innerJoin(entries, eq(entries.id, senseNuance.entryId))
    .where(language === undefined ? undefined : eq(entries.language, language))
    .orderBy(asc(senseNuance.entryId))
  return rows.map((row) => row.entryId)
}, Effect.orDie)

/** The raw Jev answers per sense, so nuance can be re-derived without inference. */
export const nuanceAnswersFor = Effect.fn("enrichment.nuanceAnswersFor")(function* (
  db: DatabaseShape,
  entryId: EntryId
) {
  return yield* db
    .select({ sense: senseNuance.sense, answers: senseNuance.answers })
    .from(senseNuance)
    .where(eq(senseNuance.entryId, entryId))
    .orderBy(asc(senseNuance.sense))
}, Effect.orDie)

/** Rewrites the interpreted nuance, leaving the answers, model and timestamp untouched. */
export const updateNuance = (db: DatabaseShape, entryId: EntryId, sense: number, nuance: Nuance) =>
  db
    .update(senseNuance)
    .set({ nuance })
    .where(and(eq(senseNuance.entryId, entryId), eq(senseNuance.sense, sense)))
    .pipe(Effect.asVoid, Effect.orDie)

/**
 * Entries whose stored nuance predates their language's question set in `versions`, most
 * frequent first, for the backfill.
 */
export const outdatedNuanceEntryIds = Effect.fn("enrichment.outdatedNuanceEntryIds")(function* (
  db: DatabaseShape,
  versions: Readonly<Record<Language, number>>,
  options: { readonly commonOnly: boolean; readonly limit: number; readonly language?: Language | undefined }
) {
  const outdated = (language: Language) =>
    and(eq(entries.language, language), lt(senseNuance.questionsVersion, versions[language]))
  const rows = yield* db
    .selectDistinct({ entryId: senseNuance.entryId, priority: entries.priority })
    .from(senseNuance)
    .innerJoin(entries, eq(entries.id, senseNuance.entryId))
    .where(
      and(
        options.language === undefined ? or(outdated("ja"), outdated("en")) : outdated(options.language),
        options.commonOnly ? eq(entries.common, true) : undefined
      )
    )
    .orderBy(desc(entries.priority), asc(senseNuance.entryId))
    .limit(options.limit)
  return rows.map((row) => row.entryId)
}, Effect.orDie)

/**
 * Saves an English word's loan verdict, or clears it when the word has no candidates left.
 * Claude's warning survives a re-judge that names the same loan, so it isn't paid for twice.
 */
export const saveLoanWord = Effect.fn("enrichment.saveLoanWord")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  row: LoanWordInput | null,
  now: Date
) {
  if (row === null) return yield* db.delete(loanWords).where(eq(loanWords.entryId, entryId))
  const fresh = {
    word: row.word,
    verdict: row.verdict,
    answers: row.answers,
    model: row.model,
    questionsVersion: row.questionsVersion,
    createdAt: now
  }
  // An upsert, not a delete: the warning Claude wrote survives while the loan stays the same.
  yield* db
    .insert(loanWords)
    .values({ entryId, ...fresh })
    .onConflictDoUpdate({
      target: loanWords.entryId,
      set: {
        ...fresh,
        trap: sql`CASE WHEN ${loanWords.word} IS NOT DISTINCT FROM excluded.word THEN ${loanWords.trap} END`
      }
    })
}, Effect.orDie)

export const loanWordsFor = Effect.fn("enrichment.loanWordsFor")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  if (entryIds.length === 0) return []
  return yield* db
    .select({
      entryId: loanWords.entryId,
      word: loanWords.word,
      verdict: loanWords.verdict,
      trap: loanWords.trap,
      questionsVersion: loanWords.questionsVersion
    })
    .from(loanWords)
    .where(inArray(loanWords.entryId, entryIds))
}, Effect.orDie)

/** The answers behind an entry's loan verdict, so it can be re-derived without inference. */
export const loanAnswersFor = Effect.fn("enrichment.loanAnswersFor")(function* (db: DatabaseShape, entryId: EntryId) {
  const rows = yield* db.select({ answers: loanWords.answers }).from(loanWords).where(eq(loanWords.entryId, entryId))
  return Option.map(Option.fromNullishOr(rows[0]), (row) => row.answers)
}, Effect.orDie)

/** Rewrites the interpreted verdict, keeping the answers; a different loan loses its warning. */
export const updateLoanWord = (db: DatabaseShape, entryId: EntryId, word: string | null, verdict: LoanVerdict | null) =>
  db
    .update(loanWords)
    .set({
      word,
      verdict,
      trap: sql`CASE WHEN ${loanWords.word} IS NOT DISTINCT FROM ${word} THEN ${loanWords.trap} END`
    })
    .where(eq(loanWords.entryId, entryId))
    .pipe(Effect.asVoid, Effect.orDie)

/** Writes Claude's warning onto the entry's loan, if it is still `word`. */
export const saveLoanTrap = (db: DatabaseShape, entryId: EntryId, word: string, trap: string) =>
  db
    .update(loanWords)
    .set({ trap })
    .where(and(eq(loanWords.entryId, entryId), eq(loanWords.word, word)))
    .pipe(Effect.asVoid, Effect.orDie)

export const saveSimilar = Effect.fn("enrichment.saveSimilar")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  rows: ReadonlyArray<SimilarInput>
) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(similarWords).where(eq(similarWords.entryId, entryId))
      if (rows.length === 0) return
      yield* tx.insert(similarWords).values(rows.map((row) => ({ entryId, ...row })))
    })
  )
}, Effect.orDie)

export const similarFor = Effect.fn("enrichment.similarFor")(function* (db: DatabaseShape, entryId: EntryId) {
  return yield* db
    .select({
      sense: similarWords.sense,
      similarId: similarWords.similarId,
      similarity: similarWords.similarity,
      difference: similarWords.difference,
      confidence: similarWords.confidence
    })
    .from(similarWords)
    .where(eq(similarWords.entryId, entryId))
    .orderBy(asc(similarWords.sense), desc(similarWords.similarity))
}, Effect.orDie)

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
      speakerGender: examples.speakerGender,
      speakerAge: examples.speakerAge,
      medium: examples.medium,
      variety: examples.variety,
      tone: examples.tone,
      source: examples.source,
      model: examples.model
    })
    .from(examples)
    .where(inArray(examples.entryId, entryIds))
    // Kotori's sentences, written for learners, before the ones seeded from Tatoeba and Wiktionary.
    .orderBy(examples.entryId, examples.sense, sql`${examples.source} <> 'kotori'`, examples.position)
}, Effect.orDie)

export const saveSenseNotes = Effect.fn("enrichment.saveSenseNotes")(function* (
  db: DatabaseShape,
  entryId: EntryId,
  rows: ReadonlyArray<SenseNoteInput>,
  now: Date
) {
  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.delete(senseNotes).where(eq(senseNotes.entryId, entryId))
      if (rows.length === 0) return
      yield* tx.insert(senseNotes).values(rows.map((row) => ({ entryId, createdAt: now, ...row })))
    })
  )
}, Effect.orDie)

export const senseNotesFor = Effect.fn("enrichment.senseNotesFor")(function* (
  db: DatabaseShape,
  entryIds: ReadonlyArray<EntryId>
) {
  if (entryIds.length === 0) return []
  return yield* db
    .select({
      entryId: senseNotes.entryId,
      sense: senseNotes.sense,
      note: senseNotes.note,
      noteJa: senseNotes.noteJa
    })
    .from(senseNotes)
    .where(inArray(senseNotes.entryId, entryIds))
}, Effect.orDie)

/** An example sentence as stored, with the speaker signals casting reads. */
export type ExampleRow = Effect.Success<ReturnType<typeof examplesFor>>[number]
