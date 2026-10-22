import { Difference, Formality, Language, Nuance } from "@kotori/domain"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

const decodeRows = <S extends Schema.Constraint>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

const NuanceRow = Schema.Struct({
  entryId: Schema.Int,
  sense: Schema.Int,
  nuance: Nuance,
  model: Schema.String
})
export type NuanceRow = typeof NuanceRow.Type

export interface NuanceInput {
  readonly sense: number
  readonly nuance: Nuance
  /** The raw model answers, kept so labels can be re-derived later. */
  readonly answers: unknown
  readonly model: string
}

const SimilarRow = Schema.Struct({
  sense: Schema.Int,
  similarId: Schema.Int,
  similarity: Schema.Number,
  difference: Difference,
  confidence: Schema.Number
})
export type SimilarRow = typeof SimilarRow.Type

const ExampleRow = Schema.Struct({
  id: Schema.Int,
  entryId: Schema.Int,
  sense: Schema.Int,
  position: Schema.Int,
  ja: Schema.String,
  furigana: Schema.String,
  en: Schema.String,
  formality: Formality,
  note: Schema.NullOr(Schema.String),
  model: Schema.String
})
export type ExampleRow = typeof ExampleRow.Type

export interface ExampleInput {
  readonly sense: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly note: string | null
  readonly model: string
}

const AudioRow = Schema.Struct({
  key: Schema.String,
  text: Schema.String,
  language: Language,
  voiceId: Schema.String,
  modelId: Schema.String,
  characters: Schema.Int,
  bytes: Schema.Int,
  createdAt: Schema.Number
})
export type AudioRow = typeof AudioRow.Type

const AudioLink = Schema.Struct({ id: Schema.Int, audioKey: Schema.String })
const ExampleAudioLink = Schema.Struct({ id: Schema.Int, language: Language, audioKey: Schema.String })
const SumRow = Schema.Struct({ n: Schema.Number })
const ClipRow = Schema.Struct({ data: Schema.Uint8Array })

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
    /** The MP3 bytes for a clip, stored in the database (`audio_clips`). */
    putAudioClip(key: string, bytes: Uint8Array): Effect.Effect<void>
    audioClip(key: string): Effect.Effect<Option.Option<Uint8Array>>
    hasAudioClip(key: string): Effect.Effect<boolean>
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
      const sql = yield* SqlClient.SqlClient

      const saveNuance = Effect.fn("EnrichmentRepo.saveNuance")(
        function* (entryId: number, rows: ReadonlyArray<NuanceInput>, now: number) {
          yield* sql`DELETE FROM sense_nuance WHERE entry_id = ${entryId}`
          if (rows.length === 0) return
          yield* sql`INSERT INTO sense_nuance ${sql.insert(
            rows.map((row) => ({
              entryId,
              sense: row.sense,
              nuance: JSON.stringify(row.nuance),
              answers: JSON.stringify(row.answers),
              model: row.model,
              createdAt: now
            }))
          )}`
        },
        (effect) => sql.withTransaction(effect),
        Effect.orDie
      )

      const nuanceFor = Effect.fn("EnrichmentRepo.nuanceFor")(function* (entryIds: ReadonlyArray<number>) {
        if (entryIds.length === 0) return []
        return yield* sql`
          SELECT entry_id, sense, nuance, model FROM sense_nuance WHERE entry_id IN ${sql.in(entryIds)}
        `.pipe(Effect.flatMap(decodeRows(NuanceRow)))
      }, Effect.orDie)

      const saveSimilar = Effect.fn("EnrichmentRepo.saveSimilar")(
        function* (entryId: number, rows: ReadonlyArray<SimilarRow>) {
          yield* sql`DELETE FROM similar_words WHERE entry_id = ${entryId}`
          if (rows.length === 0) return
          yield* sql`INSERT INTO similar_words ${sql.insert(rows.map((row) => ({ entryId, ...row })))}`
        },
        (effect) => sql.withTransaction(effect),
        Effect.orDie
      )

      const similarFor = Effect.fn("EnrichmentRepo.similarFor")(function* (entryId: number) {
        return yield* sql`
          SELECT sense, similar_id, similarity, difference, confidence
          FROM similar_words WHERE entry_id = ${entryId}
          ORDER BY sense, similarity DESC
        `.pipe(Effect.flatMap(decodeRows(SimilarRow)))
      }, Effect.orDie)

      const saveExamples = Effect.fn("EnrichmentRepo.saveExamples")(
        function* (entryId: number, rows: ReadonlyArray<ExampleInput>, now: number) {
          yield* sql`DELETE FROM example_audio WHERE example_id IN (SELECT id FROM examples WHERE entry_id = ${entryId})`
          yield* sql`DELETE FROM examples WHERE entry_id = ${entryId}`
          if (rows.length === 0) return
          const position = new Map<number, number>()
          yield* sql`INSERT INTO examples ${sql.insert(
            rows.map((row) => {
              const next = position.get(row.sense) ?? 0
              position.set(row.sense, next + 1)
              return { entryId, position: next, createdAt: now, ...row }
            })
          )}`
        },
        (effect) => sql.withTransaction(effect),
        Effect.orDie
      )

      const examplesFor = Effect.fn("EnrichmentRepo.examplesFor")(function* (entryIds: ReadonlyArray<number>) {
        if (entryIds.length === 0) return []
        return yield* sql`
          SELECT id, entry_id, sense, position, ja, furigana, en, formality, note, model
          FROM examples WHERE entry_id IN ${sql.in(entryIds)}
          ORDER BY entry_id, sense, position
        `.pipe(Effect.flatMap(decodeRows(ExampleRow)))
      }, Effect.orDie)

      const findAudio = Effect.fn("EnrichmentRepo.findAudio")(function* (key: string) {
        const rows = yield* sql`
          SELECT key, text, language, voice_id, model_id, characters, bytes, created_at FROM audio WHERE key = ${key}
        `.pipe(Effect.flatMap(decodeRows(AudioRow)))
        return Option.fromNullishOr(rows[0])
      }, Effect.orDie)

      const saveAudio = (row: AudioRow) =>
        sql`INSERT INTO audio ${sql.insert(row)} ON CONFLICT (key) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie)

      const putAudioClip = (key: string, bytes: Uint8Array) =>
        sql`
          INSERT INTO audio_clips (key, data) VALUES (${key}, ${bytes})
          ON CONFLICT (key) DO UPDATE SET data = excluded.data
        `.pipe(Effect.asVoid, Effect.orDie)

      const audioClip = Effect.fn("EnrichmentRepo.audioClip")(function* (key: string) {
        const rows = yield* sql`SELECT data FROM audio_clips WHERE key = ${key}`.pipe(
          Effect.flatMap(decodeRows(ClipRow))
        )
        return Option.fromNullishOr(rows[0]?.data)
      }, Effect.orDie)

      const hasAudioClip = (key: string) =>
        sql`SELECT 1 FROM audio_clips WHERE key = ${key}`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.orDie
        )

      const linkEntryAudio = (entryId: number, key: string) =>
        sql`
          INSERT INTO entry_audio (entry_id, audio_key) VALUES (${entryId}, ${key})
          ON CONFLICT (entry_id) DO UPDATE SET audio_key = excluded.audio_key
        `.pipe(Effect.asVoid, Effect.orDie)

      const linkExampleAudio = (exampleId: number, language: Language, key: string) =>
        sql`
          INSERT INTO example_audio (example_id, language, audio_key) VALUES (${exampleId}, ${language}, ${key})
          ON CONFLICT (example_id, language) DO UPDATE SET audio_key = excluded.audio_key
        `.pipe(Effect.asVoid, Effect.orDie)

      const entryAudio = Effect.fn("EnrichmentRepo.entryAudio")(function* (entryIds: ReadonlyArray<number>) {
        if (entryIds.length === 0) return new Map<number, string>()
        const rows = yield* sql`
          SELECT entry_id AS id, audio_key FROM entry_audio WHERE entry_id IN ${sql.in(entryIds)}
        `.pipe(Effect.flatMap(decodeRows(AudioLink)))
        return new Map(rows.map((row) => [row.id, row.audioKey]))
      }, Effect.orDie)

      const exampleAudio = Effect.fn("EnrichmentRepo.exampleAudio")(function* (exampleIds: ReadonlyArray<number>) {
        if (exampleIds.length === 0) return new Map<string, string>()
        const rows = yield* sql`
          SELECT example_id AS id, language, audio_key FROM example_audio WHERE example_id IN ${sql.in(exampleIds)}
        `.pipe(Effect.flatMap(decodeRows(ExampleAudioLink)))
        return new Map(rows.map((row) => [`${row.id}:${row.language}`, row.audioKey]))
      }, Effect.orDie)

      const audioCharactersSince = (since: number) =>
        sql`SELECT coalesce(sum(characters), 0) AS n FROM audio WHERE created_at >= ${since}`.pipe(
          Effect.flatMap(decodeRows(SumRow)),
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
        putAudioClip,
        audioClip,
        hasAudioClip,
        linkEntryAudio,
        linkExampleAudio,
        entryAudio,
        exampleAudio,
        audioCharactersSince
      })
    })
  )
}
