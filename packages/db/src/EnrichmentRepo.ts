import type { Difference, Formality, Language, Nuance } from "@kotori/domain"
import { asc, desc, eq, gte, inArray, sql, sum } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at, millis } from "./rows.ts"
import { audio, entryAudio, exampleAudio, examples, senseNuance, similarWords } from "./schema/index.ts"

export interface NuanceRow {
  readonly entryId: number
  readonly sense: number
  readonly nuance: Nuance
  readonly model: string
}

export interface NuanceInput {
  readonly sense: number
  readonly nuance: Nuance
  /** The raw model answers, kept so labels can be re-derived later. */
  readonly answers: unknown
  readonly model: string
}

export interface SimilarRow {
  readonly sense: number
  readonly similarId: number
  readonly similarity: number
  readonly difference: Difference
  readonly confidence: number
}

export interface ExampleRow {
  readonly id: number
  readonly entryId: number
  readonly sense: number
  readonly position: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly note: string | null
  readonly model: string
}

export interface ExampleInput {
  readonly sense: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly note: string | null
  readonly model: string
}

export interface AudioRow {
  readonly key: string
  readonly text: string
  readonly language: Language
  readonly voiceId: string
  readonly modelId: string
  readonly characters: number
  readonly bytes: number
  readonly createdAt: number
}

export class EnrichmentRepo extends Context.Service<
  EnrichmentRepo,
  {
    saveNuance(entryId: number, rows: ReadonlyArray<NuanceInput>, now: number): Effect.Effect<void>
    nuanceFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<NuanceRow>>
    saveSimilar(entryId: number, rows: ReadonlyArray<SimilarRow>): Effect.Effect<void>
    similarFor(entryId: number): Effect.Effect<ReadonlyArray<SimilarRow>>
    saveExamples(entryId: number, rows: ReadonlyArray<ExampleInput>, now: number): Effect.Effect<void>
    examplesFor(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<ExampleRow>>
    findAudio(key: string): Effect.Effect<Option.Option<AudioRow>>
    saveAudio(row: AudioRow): Effect.Effect<void>
    linkEntryAudio(entryId: number, key: string): Effect.Effect<void>
    linkExampleAudio(exampleId: number, language: Language, key: string): Effect.Effect<void>
    entryAudio(entryIds: ReadonlyArray<number>): Effect.Effect<ReadonlyMap<number, string>>
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
            model: senseNuance.model
          })
          .from(senseNuance)
          .where(inArray(senseNuance.entryId, entryIds))
      }, Effect.orDie)

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
            model: examples.model
          })
          .from(examples)
          .where(inArray(examples.entryId, entryIds))
          .orderBy(examples.entryId, examples.sense, examples.position)
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
        db
          .insert(entryAudio)
          .values({ entryId, audioKey: key })
          .onConflictDoUpdate({ target: entryAudio.entryId, set: { audioKey: key } })
          .pipe(Effect.asVoid, Effect.orDie)

      const linkExampleAudio = (exampleId: number, language: Language, key: string) =>
        db
          .insert(exampleAudio)
          .values({ exampleId, language, audioKey: key })
          .onConflictDoUpdate({ target: [exampleAudio.exampleId, exampleAudio.language], set: { audioKey: key } })
          .pipe(Effect.asVoid, Effect.orDie)

      const entryAudioFor = Effect.fn("EnrichmentRepo.entryAudio")(function* (entryIds: ReadonlyArray<number>) {
        if (entryIds.length === 0) return new Map<number, string>()
        const rows = yield* db.select().from(entryAudio).where(inArray(entryAudio.entryId, entryIds))
        return new Map(rows.map((row) => [row.entryId, row.audioKey]))
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
        saveSimilar,
        similarFor,
        saveExamples,
        examplesFor,
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
