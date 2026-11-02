import { Pronouncer, TtsError, type Voice } from "@kotori/ai"
import type { Language } from "@kotori/domain"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { EnrichmentRepo } from "../enrichment/EnrichmentRepo.ts"
import { AudioStore } from "./AudioStore.ts"

const MONTH = 30 * 24 * 60 * 60 * 1000

/**
 * Kotori's library of speech clips. A clip is content-addressed by voice, model, language and
 * text, so the same phrase is never paid for twice; new ones are made only while the month's
 * character budget lasts.
 */
export class Speech extends Context.Service<
  Speech,
  {
    readonly configured: boolean
    /**
     * The audio key for `text` read by `voice` (by default the language's first dictionary
     * voice), synthesising it only if that voice hasn't spoken it yet.
     */
    speak(text: string, language: Language, voice?: Voice): Effect.Effect<string, TtsError>
  }
>()("@kotori/backend/Speech") {
  static readonly layer = Layer.effect(
    Speech,
    Effect.gen(function* () {
      const pronouncer = yield* Pronouncer
      const store = yield* AudioStore
      const repo = yield* EnrichmentRepo
      const budget = yield* Config.Int("KOTORI_AUDIO_MONTHLY_CHARS").pipe(Config.withDefault(50_000))

      const keyFor = (text: string, language: Language, providerId: string) =>
        createHash("sha256").update([providerId, pronouncer.model, language, text].join("\n")).digest("hex")

      const speak = Effect.fn("Speech.speak")(function* (text: string, language: Language, voice?: Voice) {
        const reader = voice ?? (yield* pronouncer.defaultVoice(language))
        if (reader.providerId === null) {
          return yield* new TtsError({ reason: "unconfigured", message: `${reader.id} has no provider voice yet` })
        }
        const normalized = text.trim()
        const key = keyFor(normalized, language, reader.providerId)
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

        const bytes = yield* pronouncer.synthesize(normalized, language, reader)
        // The clip's row first: `audio_files` references it.
        yield* repo.saveAudio({
          key,
          text: normalized,
          language,
          voiceId: reader.providerId,
          voice: reader.id,
          modelId: pronouncer.model,
          characters: normalized.length,
          bytes: bytes.byteLength,
          createdAt: now
        })
        yield* store.put(key, bytes)
        return key
      })

      return Speech.of({ configured: pronouncer.configured, speak })
    })
  )
}
