import type {
  CastBy,
  Difference,
  EnglishJudgments,
  Formality,
  Language,
  Nuance,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/domain"
import { and, asc, desc, eq, gte, inArray, lt, sum } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at, millis } from "./rows.ts"
import {
  audio,
  englishNuance,
  entries,
  entryAudio,
  exampleAudio,
  examples,
  senseNotes,
  senseNuance,
  similarWords
} from "./schema/index.ts"

export interface NuanceRow {
  readonly entryId: number
  readonly sense: number
  readonly nuance: Nuance
  readonly model: string
  /** Which question set produced the stored answers. */
  readonly questionsVersion: number
}

export interface NuanceInput {
  readonly sense: number
  readonly nuance: Nuance
  /** The raw model answers, kept so labels can be re-derived later. */
  readonly answers: unknown
  readonly model: string
  readonly questionsVersion: number
}

export interface EnglishNuanceRow {
  readonly entryId: number
  readonly sense: number
  readonly nuance: EnglishJudgments
  /** Claude's katakana loanword and trap sentence; null until the examples job writes them. */
  readonly loanWord: string | null
  readonly loanTrap: string | null
  readonly questionsVersion: number
}

export interface EnglishNuanceInput {
  readonly sense: number
  readonly nuance: EnglishJudgments
  readonly answers: unknown
  readonly model: string
  readonly questionsVersion: number
}

export interface SimilarRow {
  readonly sense: number
  readonly similarId: number
  readonly similarity: number
  readonly difference: Difference
  readonly confidence: number
}

/** The usage note for one sense, in both learner directions. */
export interface SenseNoteRow {
  readonly entryId: number
  readonly sense: number
  /** For learners of Japanese, in English; null when the glosses say it all. */
  readonly note: string | null
  /** For Japanese speakers learning English, in Japanese. */
  readonly noteJa: string | null
}

export interface SenseNoteInput {
  readonly sense: number
  readonly note: string | null
  readonly noteJa: string | null
  readonly model: string
}

/** Who would say the sentence and how; null on sentences written before voice casting. */
export interface CastingSignals {
  readonly speakerGender: SpeakerGender | null
  readonly speakerAge: SpeakerAge | null
  readonly medium: SentenceMedium | null
  /** Regional variety label ("kansai", "british"); null for the language's default. */
  readonly variety: string | null
  readonly tone: SentenceTone | null
}

export interface ExampleRow extends CastingSignals {
  readonly id: number
  readonly entryId: number
  readonly sense: number
  readonly position: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly note: string | null
  /** The note for Japanese speakers, in Japanese; null on sentences written before it existed. */
  readonly noteJa: string | null
  readonly model: string
}

export interface ExampleInput extends Partial<CastingSignals> {
  readonly sense: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly note: string | null
  readonly noteJa?: string | null
  readonly model: string
}

export interface AudioRow {
  readonly key: string
  readonly text: string
  readonly language: Language
  /** The provider's voice id. */
  readonly voiceId: string
  /** The Kotori cast voice, e.g. "ja-kyoko"; null when the clip was not cast. */
  readonly voice: string | null
  readonly modelId: string
  readonly characters: number
  readonly bytes: number
  readonly createdAt: number
}

/** A headword clip and the cast voice that reads it. */
export interface EntryClip {
  readonly key: string
  readonly voice: string | null
}

/** How an example clip's voice was chosen. */
export interface Casting {
  readonly castBy: CastBy
  readonly score: number | null
}

export class EnrichmentRepo extends Context.Service<
  EnrichmentRepo,
  {
    saveNuance(entryId: number, rows: ReadonlyArray<NuanceInput>, now: number): Effect.Effect<void>
    nuanceFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<NuanceRow>>
    /** Every entry holding stored nuance, for reinterpretation sweeps. */
    nuanceEntryIds(): Effect.Effect<ReadonlyArray<number>>
    /** The raw Jev answers per sense, so nuance can be re-derived without inference. */
    nuanceAnswersFor(
      entryId: number
    ): Effect.Effect<ReadonlyArray<{ readonly sense: number; readonly answers: unknown }>>
    /** Rewrites the interpreted nuance, leaving the answers, model and timestamp untouched. */
    updateNuance(entryId: number, sense: number, nuance: Nuance): Effect.Effect<void>
    /** Entries whose stored nuance predates `version`, most frequent first, for the backfill. */
    outdatedNuanceEntryIds(version: number, commonOnly: boolean, limit: number): Effect.Effect<ReadonlyArray<number>>
    /** Upserts the English-side judgments, preserving Claude's loanword prose on re-runs. */
    saveEnglishNuance(entryId: number, rows: ReadonlyArray<EnglishNuanceInput>, now: number): Effect.Effect<void>
    englishNuanceFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<EnglishNuanceRow>>
    englishAnswersFor(
      entryId: number
    ): Effect.Effect<ReadonlyArray<{ readonly sense: number; readonly answers: unknown }>>
    updateEnglishNuance(entryId: number, sense: number, nuance: EnglishJudgments): Effect.Effect<void>
    /** Writes Claude's loanword prose onto an existing English judgment; a no-op without one. */
    saveLoanTrap(entryId: number, sense: number, loanWord: string, loanTrap: string | null): Effect.Effect<void>
    saveSimilar(entryId: number, rows: ReadonlyArray<SimilarRow>): Effect.Effect<void>
    similarFor(entryId: number): Effect.Effect<ReadonlyArray<SimilarRow>>
    saveExamples(entryId: number, rows: ReadonlyArray<ExampleInput>, now: number): Effect.Effect<void>
    examplesFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ExampleRow>>
    saveSenseNotes(entryId: number, rows: ReadonlyArray<SenseNoteInput>, now: number): Effect.Effect<void>
    senseNotesFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<SenseNoteRow>>
    findAudio(key: string): Effect.Effect<Option.Option<AudioRow>>
    saveAudio(row: AudioRow): Effect.Effect<void>
    /** Adds a headword clip to the entry; an entry has one clip per dictionary voice. */
    linkEntryAudio(entryId: number, key: string): Effect.Effect<void>
    linkExampleAudio(exampleId: number, language: Language, key: string, casting?: Casting): Effect.Effect<void>
    /** Headword clips per entry, oldest first. */
    entryAudio(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyMap<number, ReadonlyArray<EntryClip>>>
    /** Audio keys per example, as `${exampleId}:${language}`. */
    exampleAudio(exampleIds: ReadonlyArray<number>): Effect.Effect<ReadonlyMap<string, string>>
    /** Characters sent to the TTS provider since `since`, for budgeting. */
    audioCharactersSince(since: number): Effect.Effect<number>
  }
>()("@kotori/db/EnrichmentRepo") {
  static readonly layer = Layer.effect(
    EnrichmentRepo,
    Effect.gen(function* () {
      const db = yield* Database

      const saveNuance = Effect.fn("EnrichmentRepo.saveNuance")(function* (
        entryId: number,
        rows: ReadonlyArray<NuanceInput>,
        now: number
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
                createdAt: at(now)
              }))
            )
          })
        )
      }, Effect.orDie)

      const nuanceFor = Effect.fn("EnrichmentRepo.nuanceFor")(function* (entryIds: ReadonlyArray<number>) {
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

      const nuanceEntryIds = Effect.fn("EnrichmentRepo.nuanceEntryIds")(function* () {
        const rows = yield* db
          .selectDistinct({ entryId: senseNuance.entryId })
          .from(senseNuance)
          .orderBy(asc(senseNuance.entryId))
        return rows.map((row) => row.entryId)
      }, Effect.orDie)

      const nuanceAnswersFor = Effect.fn("EnrichmentRepo.nuanceAnswersFor")(function* (entryId: number) {
        return yield* db
          .select({ sense: senseNuance.sense, answers: senseNuance.answers })
          .from(senseNuance)
          .where(eq(senseNuance.entryId, entryId))
          .orderBy(asc(senseNuance.sense))
      }, Effect.orDie)

      const updateNuance = (entryId: number, sense: number, nuance: Nuance) =>
        db
          .update(senseNuance)
          .set({ nuance })
          .where(and(eq(senseNuance.entryId, entryId), eq(senseNuance.sense, sense)))
          .pipe(Effect.asVoid, Effect.orDie)

      const outdatedNuanceEntryIds = Effect.fn("EnrichmentRepo.outdatedNuanceEntryIds")(function* (
        version: number,
        commonOnly: boolean,
        limit: number
      ) {
        const rows = yield* db
          .selectDistinct({ entryId: senseNuance.entryId, priority: entries.priority })
          .from(senseNuance)
          .innerJoin(entries, eq(entries.id, senseNuance.entryId))
          .where(
            commonOnly
              ? and(lt(senseNuance.questionsVersion, version), eq(entries.common, true))
              : lt(senseNuance.questionsVersion, version)
          )
          .orderBy(desc(entries.priority), asc(senseNuance.entryId))
          .limit(limit)
        return rows.map((row) => row.entryId)
      }, Effect.orDie)

      const saveEnglishNuance = Effect.fn("EnrichmentRepo.saveEnglishNuance")(function* (
        entryId: number,
        rows: ReadonlyArray<EnglishNuanceInput>,
        now: number
      ) {
        if (rows.length === 0) return
        // An upsert, not delete-and-insert: the loanword prose Claude wrote must survive re-judging.
        yield* Effect.forEach(
          rows,
          (row) => {
            const judged = {
              nuance: row.nuance,
              answers: row.answers,
              model: row.model,
              questionsVersion: row.questionsVersion,
              createdAt: at(now)
            }
            return db
              .insert(englishNuance)
              .values({ entryId, sense: row.sense, ...judged })
              .onConflictDoUpdate({ target: [englishNuance.entryId, englishNuance.sense], set: judged })
          },
          { discard: true }
        )
      }, Effect.orDie)

      const englishNuanceFor = Effect.fn("EnrichmentRepo.englishNuanceFor")(function* (
        entryIds: ReadonlyArray<number>
      ) {
        if (entryIds.length === 0) return []
        return yield* db
          .select({
            entryId: englishNuance.entryId,
            sense: englishNuance.sense,
            nuance: englishNuance.nuance,
            loanWord: englishNuance.loanWord,
            loanTrap: englishNuance.loanTrap,
            questionsVersion: englishNuance.questionsVersion
          })
          .from(englishNuance)
          .where(inArray(englishNuance.entryId, entryIds))
      }, Effect.orDie)

      const englishAnswersFor = Effect.fn("EnrichmentRepo.englishAnswersFor")(function* (entryId: number) {
        return yield* db
          .select({ sense: englishNuance.sense, answers: englishNuance.answers })
          .from(englishNuance)
          .where(eq(englishNuance.entryId, entryId))
          .orderBy(asc(englishNuance.sense))
      }, Effect.orDie)

      const updateEnglishNuance = (entryId: number, sense: number, nuance: EnglishJudgments) =>
        db
          .update(englishNuance)
          .set({ nuance })
          .where(and(eq(englishNuance.entryId, entryId), eq(englishNuance.sense, sense)))
          .pipe(Effect.asVoid, Effect.orDie)

      const saveLoanTrap = (entryId: number, sense: number, loanWord: string, loanTrap: string | null) =>
        db
          .update(englishNuance)
          .set({ loanWord, loanTrap })
          .where(and(eq(englishNuance.entryId, entryId), eq(englishNuance.sense, sense)))
          .pipe(Effect.asVoid, Effect.orDie)

      const saveSimilar = Effect.fn("EnrichmentRepo.saveSimilar")(function* (
        entryId: number,
        rows: ReadonlyArray<SimilarRow>
      ) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(similarWords).where(eq(similarWords.entryId, entryId))
            if (rows.length === 0) return
            yield* tx.insert(similarWords).values(rows.map((row) => ({ entryId, ...row })))
          })
        )
      }, Effect.orDie)

      const similarFor = Effect.fn("EnrichmentRepo.similarFor")(function* (entryId: number) {
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

      const saveExamples = Effect.fn("EnrichmentRepo.saveExamples")(function* (
        entryId: number,
        rows: ReadonlyArray<ExampleInput>,
        now: number
      ) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // Audio links cascade from the examples.
            yield* tx.delete(examples).where(eq(examples.entryId, entryId))
            if (rows.length === 0) return
            const position = new Map<number, number>()
            yield* tx.insert(examples).values(
              rows.map((row) => {
                const next = position.get(row.sense) ?? 0
                position.set(row.sense, next + 1)
                return { entryId, position: next, createdAt: at(now), ...row }
              })
            )
          })
        )
      }, Effect.orDie)

      const examplesFor = Effect.fn("EnrichmentRepo.examplesFor")(function* (entryIds: ReadonlyArray<number>) {
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
            model: examples.model
          })
          .from(examples)
          .where(inArray(examples.entryId, entryIds))
          .orderBy(examples.entryId, examples.sense, examples.position)
      }, Effect.orDie)

      const saveSenseNotes = Effect.fn("EnrichmentRepo.saveSenseNotes")(function* (
        entryId: number,
        rows: ReadonlyArray<SenseNoteInput>,
        now: number
      ) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(senseNotes).where(eq(senseNotes.entryId, entryId))
            if (rows.length === 0) return
            yield* tx.insert(senseNotes).values(rows.map((row) => ({ entryId, createdAt: at(now), ...row })))
          })
        )
      }, Effect.orDie)

      const senseNotesFor = Effect.fn("EnrichmentRepo.senseNotesFor")(function* (entryIds: ReadonlyArray<number>) {
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

      const findAudio = Effect.fn("EnrichmentRepo.findAudio")(function* (key: string) {
        const rows = yield* db.select().from(audio).where(eq(audio.key, key))
        return Option.fromNullishOr(rows[0]).pipe(
          Option.map((row): AudioRow => ({ ...row, createdAt: millis(row.createdAt) }))
        )
      }, Effect.orDie)

      const saveAudio = (row: AudioRow) =>
        db
          .insert(audio)
          .values({ ...row, createdAt: at(row.createdAt) })
          .onConflictDoNothing()
          .pipe(Effect.asVoid, Effect.orDie)

      const linkEntryAudio = (entryId: number, key: string) =>
        db.insert(entryAudio).values({ entryId, audioKey: key }).onConflictDoNothing().pipe(Effect.asVoid, Effect.orDie)

      const linkExampleAudio = (exampleId: number, language: Language, key: string, casting?: Casting) => {
        const row = { audioKey: key, castBy: casting?.castBy ?? null, score: casting?.score ?? null }
        return db
          .insert(exampleAudio)
          .values({ exampleId, language, ...row })
          .onConflictDoUpdate({ target: [exampleAudio.exampleId, exampleAudio.language], set: row })
          .pipe(Effect.asVoid, Effect.orDie)
      }

      const entryAudioFor = Effect.fn("EnrichmentRepo.entryAudio")(function* (entryIds: ReadonlyArray<number>) {
        const clips = new Map<number, Array<EntryClip>>()
        if (entryIds.length === 0) return clips
        const rows = yield* db
          .select({ entryId: entryAudio.entryId, key: entryAudio.audioKey, voice: audio.voice })
          .from(entryAudio)
          .innerJoin(audio, eq(audio.key, entryAudio.audioKey))
          .where(inArray(entryAudio.entryId, entryIds))
          .orderBy(asc(audio.createdAt), asc(audio.key))
        for (const { entryId, ...clip } of rows) {
          const list = clips.get(entryId)
          if (list === undefined) clips.set(entryId, [clip])
          else list.push(clip)
        }
        return clips
      }, Effect.orDie)

      const exampleAudioFor = Effect.fn("EnrichmentRepo.exampleAudio")(function* (exampleIds: ReadonlyArray<number>) {
        if (exampleIds.length === 0) return new Map<string, string>()
        const rows = yield* db.select().from(exampleAudio).where(inArray(exampleAudio.exampleId, exampleIds))
        return new Map(rows.map((row) => [`${row.exampleId}:${row.language}`, row.audioKey]))
      }, Effect.orDie)

      const audioCharactersSince = (since: number) =>
        db
          .select({ n: sum(audio.characters).mapWith(Number) })
          .from(audio)
          .where(gte(audio.createdAt, at(since)))
          .pipe(
            Effect.map((rows) => rows[0]?.n ?? 0),
            Effect.orDie
          )

      return EnrichmentRepo.of({
        saveNuance,
        nuanceFor,
        nuanceEntryIds,
        nuanceAnswersFor,
        updateNuance,
        outdatedNuanceEntryIds,
        saveEnglishNuance,
        englishNuanceFor,
        englishAnswersFor,
        updateEnglishNuance,
        saveLoanTrap,
        saveSimilar,
        similarFor,
        saveExamples,
        examplesFor,
        saveSenseNotes,
        senseNotesFor,
        findAudio,
        saveAudio,
        linkEntryAudio,
        linkExampleAudio,
        entryAudio: entryAudioFor,
        exampleAudio: exampleAudioFor,
        audioCharactersSince
      })
    })
  )
}
