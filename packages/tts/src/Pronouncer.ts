import { DictionaryRepo, EnrichmentRepo } from "@kotori/db"
import type { Language } from "@kotori/domain"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { AudioStore } from "./AudioStore.ts"
import { ElevenLabs, TtsError } from "./ElevenLabs.ts"

const MONTH = 30 * 24 * 60 * 60 * 1000

export interface AudioSummary {
  readonly clips: number
  readonly characters: number
}

/** Turns text into cached pronunciation clips, keeping TTS spend within a monthly character budget. */
export class Pronouncer extends Context.Service<Pronouncer, {
  readonly configured: boolean
  /** Returns the audio key for `text`, synthesising it only if it isn't cached yet. */
  speak(text: string, language: Language): Effect.Effect<string, TtsError>
  /** Audio for an entry's headword and example sentences. */
  enrichEntry(entryId: number): Effect.Effect<AudioSummary, TtsError>
}>()("@kotori/tts/Pronouncer") {
  static readonly layer = Layer.effect(
    Pronouncer,
    Effect.gen(function*() {
      const tts = yield* ElevenLabs
      const store = yield* AudioStore
      const repo = yield* EnrichmentRepo
      const dictionary = yield* DictionaryRepo
      const budget = yield* Config.Int("KOTORI_AUDIO_MONTHLY_CHARS").pipe(Config.withDefault(50_000))
      const exampleLanguages = (yield* Config.String("KOTORI_AUDIO_LANGUAGES").pipe(Config.withDefault("ja")))
        .split(",")
        .map((language) => language.trim())

      const keyFor = (text: string, language: Language) =>
        createHash("sha256").update([tts.voiceFor(language), tts.model, language, text].join("\n")).digest("hex")

      const speak = Effect.fn("Pronouncer.speak")(function*(text: string, language: Language) {
        const normalized = text.trim()
        const key = keyFor(normalized, language)
        const cached = yield* repo.findAudio(key)
        if (Option.isSome(cached) && (yield* store.exists(key))) return key

        const now = yield* Clock.currentTimeMillis
        const used = yield* repo.audioCharactersSince(now - MONTH)
        if (used + normalized.length > budget) {
          return yield* new TtsError({
            reason: "quota",
            message: `Monthly audio budget of ${budget} characters reached (KOTORI_AUDIO_MONTHLY_CHARS)`
          })
        }

        const bytes = yield* tts.synthesize(normalized, language)
        yield* store.put(key, bytes)
        yield* repo.saveAudio({
          key,
          text: normalized,
          language,
          voiceId: tts.voiceFor(language),
          modelId: tts.model,
          characters: normalized.length,
          bytes: bytes.byteLength,
          createdAt: now
        })
        return key
      })

      const enrichEntry = Effect.fn("Pronouncer.enrichEntry")(function*(entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return { clips: 0, characters: 0 }
        let clips = 0
        let characters = 0
        const track = (text: string) => {
          clips++
          characters += text.length
        }

        // The kana reading pins down the pronunciation; kanji alone can be ambiguous (生, 今日…).
        yield* repo.linkEntryAudio(entryId, yield* speak(entry.reading, "ja"))
        track(entry.reading)

        const examples = yield* repo.examplesFor([entryId])
        yield* Effect.forEach(examples, (example) =>
          Effect.gen(function*() {
            yield* repo.linkExampleAudio(example.id, "ja", yield* speak(example.ja, "ja"))
            track(example.ja)
            if (exampleLanguages.includes("en")) {
              yield* repo.linkExampleAudio(example.id, "en", yield* speak(example.en, "en"))
              track(example.en)
            }
          }), { concurrency: 2, discard: true })

        return { clips, characters }
      })

      return Pronouncer.of({ configured: tts.configured, speak, enrichEntry })
    })
  )
}
