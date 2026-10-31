import type {
  CastBy,
  Difference,
  Formality,
  Language,
  Loanword,
  Nuance,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/domain"
import { and, asc, desc, eq, gte, inArray, lt, or, sql, sum } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at, millis } from "./rows.ts"
import {
  audio,
  entries,
  entryAudio,
  exampleAudio,
  examples,
  loanWords,
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

/** An English word's katakana loan, as judged; Claude's warning once written. */
export interface LoanWordRow {
  readonly entryId: number
  /** The candidate Jev judged the English word's loan, as JMDict spells it; null when none was. */
  readonly word: string | null
  readonly verdict: Loanword["verdict"] | null
  readonly trap: string | null
  readonly questionsVersion: number
}

export interface LoanWordInput {
  readonly word: string | null
  readonly verdict: Loanword["verdict"] | null
  /** Jev's answers about each candidate, and the candidates asked about. */
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

/** The usage note for one sense, in the learner's language: English on Japanese words, Japanese on English ones. */
export interface SenseNoteRow {
  readonly entryId: number
  readonly sense: number
  /** On a Japanese word, for learners of Japanese, in English; null when the glosses say it all. */
  readonly note: string | null
  /** On an English word, for learners of English, in Japanese; null likewise. */
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
    /** Every entry holding stored nuance, in one dictionary or both, for reinterpretation sweeps. */
    nuanceEntryIds(language?: Language): Effect.Effect<ReadonlyArray<number>>
    /** The raw Jev answers per sense, so nuance can be re-derived without inference. */
    nuanceAnswersFor(
      entryId: number
    ): Effect.Effect<ReadonlyArray<{ readonly sense: number; readonly answers: unknown }>>
    /** Rewrites the interpreted nuance, leaving the answers, model and timestamp untouched. */
    updateNuance(entryId: number, sense: number, nuance: Nuance): Effect.Effect<void>
    /**
     * Entries whose stored nuance predates their language's question set in `versions`, most
     * frequent first, for the backfill.
     */
    outdatedNuanceEntryIds(
      versions: Readonly<Record<Language, number>>,
      options: { readonly commonOnly: boolean; readonly limit: number; readonly language?: Language | undefined }
    ): Effect.Effect<ReadonlyArray<number>>
    /**
     * Saves an English word's loan verdict, or clears it when the word has no candidates left.
     * Claude's warning survives a re-judge that names the same loan, so it isn't paid for twice.
     */
    saveLoanWord(entryId: number, row: LoanWordInput | null, now: number): Effect.Effect<void>
    loanWordsFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<LoanWordRow>>
    /** The answers behind an entry's loan verdict, so it can be re-derived without inference. */
    loanAnswersFor(entryId: number): Effect.Effect<Option.Option<unknown>>
    /** Rewrites the interpreted verdict, keeping the answers; a different loan loses its warning. */
    updateLoanWord(entryId: number, word: string | null, verdict: Loanword["verdict"] | null): Effect.Effect<void>
    /** Writes Claude's warning onto the entry's loan, if it is still `word`. */
    saveLoanTrap(entryId: number, word: string, trap: string): Effect.Effect<void>
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

      const nuanceEntryIds = Effect.fn("EnrichmentRepo.nuanceEntryIds")(function* (language?: Language) {
        const rows = yield* db
          .selectDistinct({ entryId: senseNuance.entryId })
          .from(senseNuance)
          .innerJoin(entries, eq(entries.id, senseNuance.entryId))
          .where(language === undefined ? undefined : eq(entries.language, language))
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

      const saveLoanWord = Effect.fn("EnrichmentRepo.saveLoanWord")(function* (
        entryId: number,
        row: LoanWordInput | null,
        now: number
      ) {
        if (row === null) return yield* db.delete(loanWords).where(eq(loanWords.entryId, entryId))
        const fresh = {
          word: row.word,
          verdict: row.verdict,
          answers: row.answers,
          model: row.model,
          questionsVersion: row.questionsVersion,
          createdAt: at(now)
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

      const loanWordsFor = Effect.fn("EnrichmentRepo.loanWordsFor")(function* (entryIds: ReadonlyArray<number>) {
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

      const loanAnswersFor = Effect.fn("EnrichmentRepo.loanAnswersFor")(function* (entryId: number) {
        const rows = yield* db
          .select({ answers: loanWords.answers })
          .from(loanWords)
          .where(eq(loanWords.entryId, entryId))
        return Option.map(Option.fromNullishOr(rows[0]), (row) => row.answers)
      }, Effect.orDie)

      const updateLoanWord = (entryId: number, word: string | null, verdict: Loanword["verdict"] | null) =>
        db
          .update(loanWords)
          .set({
            word,
            verdict,
            trap: sql`CASE WHEN ${loanWords.word} IS NOT DISTINCT FROM ${word} THEN ${loanWords.trap} END`
          })
          .where(eq(loanWords.entryId, entryId))
          .pipe(Effect.asVoid, Effect.orDie)

      const saveLoanTrap = (entryId: number, word: string, trap: string) =>
        db
          .update(loanWords)
          .set({ trap })
          .where(and(eq(loanWords.entryId, entryId), eq(loanWords.word, word)))
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
        saveLoanWord,
        loanWordsFor,
        loanAnswersFor,
        updateLoanWord,
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
