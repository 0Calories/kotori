import { at, Database } from "@kotori/db"
import { audio, audioFiles, entryAudio, exampleAudio } from "@kotori/db/schema"
import type { Language } from "@kotori/domain"
import { ElevenLabs, TtsError } from "@kotori/tts"
import { eq, gte, inArray, sum } from "drizzle-orm"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { getEntries } from "../dictionary/entries.ts"
import { examplesFor } from "./examples.ts"
import { EntryNotFound } from "./nuance.ts"

const MONTH = 30 * 24 * 60 * 60 * 1000

/** Audio keys are sha256 hex digests, which also makes them safe to use in paths and URLs. */
export const isAudioKey = (key: string) => /^[a-f0-9]{64}$/.test(key)

/** Where the API serves a clip. */
export const audioUrl = (key: string) => `/audio/${key}.mp3`

/** How much speech Kotori may pay for, and which languages example sentences are voiced in. */
export class AudioSettings extends Context.Service<
  AudioSettings,
  { readonly monthlyCharacters: number; readonly exampleLanguages: ReadonlyArray<string> }
>()("@kotori/services/AudioSettings") {
  static readonly layer = Layer.effect(
    AudioSettings,
    Effect.gen(function* () {
      const monthlyCharacters = yield* Config.Int("KOTORI_AUDIO_MONTHLY_CHARS").pipe(Config.withDefault(50_000))
      const exampleLanguages = (yield* Config.String("KOTORI_AUDIO_LANGUAGES").pipe(Config.withDefault("ja")))
        .split(",")
        .map((language) => language.trim())
      return AudioSettings.of({ monthlyCharacters, exampleLanguages })
    })
  )
}

const isCached = Effect.fn("enrichment.isCached")(function* (key: string) {
  const db = yield* Database
  const rows = yield* db
    .select({ key: audioFiles.key })
    .from(audio)
    .innerJoin(audioFiles, eq(audioFiles.key, audio.key))
    .where(eq(audio.key, key))
  return rows.length > 0
}, Effect.orDie)

/** Characters sent to the TTS provider since `since`, for the budget. */
const charactersSince = Effect.fn("enrichment.charactersSince")(function* (since: number) {
  const db = yield* Database
  const rows = yield* db
    .select({ n: sum(audio.characters).mapWith(Number) })
    .from(audio)
    .where(gte(audio.createdAt, at(since)))
  return rows[0]?.n ?? 0
}, Effect.orDie)

/**
 * The audio key for `text` spoken in `language`. Clips are content-addressed (voice, model,
 * language, text), so each is synthesised once, and only within the monthly character budget.
 */
export const speak = Effect.fn("enrichment.speak")(function* (text: string, language: Language) {
  const tts = yield* ElevenLabs
  const { monthlyCharacters } = yield* AudioSettings
  const normalized = text.trim()
  const key = createHash("sha256")
    .update([tts.voiceFor(language), tts.model, language, normalized].join("\n"))
    .digest("hex")
  if (yield* isCached(key)) return key

  const now = yield* Clock.currentTimeMillis
  if ((yield* charactersSince(now - MONTH)) + normalized.length > monthlyCharacters) {
    return yield* new TtsError({
      reason: "quota",
      message: `Monthly audio budget of ${monthlyCharacters} characters reached (KOTORI_AUDIO_MONTHLY_CHARS)`
    })
  }

  const bytes = yield* tts.synthesize(normalized, language)
  // `bytea` travels as a Buffer; the view shares the bytes without copying them.
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const db = yield* Database
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .insert(audio)
          .values({
            key,
            text: normalized,
            language,
            voiceId: tts.voiceFor(language),
            modelId: tts.model,
            characters: normalized.length,
            bytes: bytes.byteLength,
            createdAt: at(now)
          })
          .onConflictDoNothing()
        yield* tx.insert(audioFiles).values({ key, data }).onConflictDoUpdate({ target: audioFiles.key, set: { data } })
      })
    )
    .pipe(Effect.orDie)
  return key
})

/** Voices an entry's headword and its example sentences, linking each clip to what it says. */
export const voiceEntry = Effect.fn("enrichment.voiceEntry")(function* (entryId: number) {
  const db = yield* Database
  const { exampleLanguages } = yield* AudioSettings
  const [entry] = yield* getEntries([entryId])
  if (entry === undefined) return yield* new EntryNotFound({ entryId })
  let clips = 0
  let characters = 0
  const track = (text: string) => {
    clips++
    characters += text.length
  }

  const linkExample = (exampleId: number, language: Language, text: string) =>
    Effect.gen(function* () {
      const audioKey = yield* speak(text, language)
      yield* db
        .insert(exampleAudio)
        .values({ exampleId, language, audioKey })
        .onConflictDoUpdate({ target: [exampleAudio.exampleId, exampleAudio.language], set: { audioKey } })
        .pipe(Effect.orDie)
      track(text)
    })

  // The kana reading pins down the pronunciation; kanji alone can be ambiguous (生, 今日…).
  const audioKey = yield* speak(entry.reading, "ja")
  yield* db
    .insert(entryAudio)
    .values({ entryId, audioKey })
    .onConflictDoUpdate({ target: entryAudio.entryId, set: { audioKey } })
    .pipe(Effect.orDie)
  track(entry.reading)

  yield* Effect.forEach(
    yield* examplesFor([entryId]),
    (example) =>
      Effect.gen(function* () {
        yield* linkExample(example.id, "ja", example.ja)
        if (exampleLanguages.includes("en")) yield* linkExample(example.id, "en", example.en)
      }),
    { concurrency: 2, discard: true }
  )

  return { clips, characters }
})

/** The MP3 bytes of a clip. */
export const clip = Effect.fn("enrichment.clip")(function* (key: string) {
  if (!isAudioKey(key)) return Option.none<Uint8Array>()
  const db = yield* Database
  const rows = yield* db.select({ data: audioFiles.data }).from(audioFiles).where(eq(audioFiles.key, key))
  return Option.fromNullishOr(rows[0]?.data).pipe(Option.map((data) => new Uint8Array(data)))
}, Effect.orDie)

/** The headword clip of each entry that has one. */
export const entryClips = Effect.fn("enrichment.entryClips")(function* (entryIds: ReadonlyArray<number>) {
  if (entryIds.length === 0) return new Map<number, string>()
  const db = yield* Database
  const rows = yield* db.select().from(entryAudio).where(inArray(entryAudio.entryId, entryIds))
  return new Map(rows.map((row) => [row.entryId, row.audioKey]))
}, Effect.orDie)

/** Clips of example sentences, keyed `${exampleId}:${language}`. */
export const exampleClips = Effect.fn("enrichment.exampleClips")(function* (exampleIds: ReadonlyArray<number>) {
  if (exampleIds.length === 0) return new Map<string, string>()
  const db = yield* Database
  const rows = yield* db.select().from(exampleAudio).where(inArray(exampleAudio.exampleId, exampleIds))
  return new Map(rows.map((row) => [`${row.exampleId}:${row.language}`, row.audioKey]))
}, Effect.orDie)
