import { Pronouncer, TtsError, type Voice } from "@kotori/ai"
import type { Language } from "@kotori/contracts"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { AudioStore } from "./AudioStore.ts"
import { audioCharactersSince, findAudio, saveAudio } from "./queries.ts"

export const AUDIO_BUDGET_WINDOW = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_AUDIO_MONTHLY_CHARS = 500_000

export class Speech extends Context.Service<
  Speech,
  {
    readonly configured: boolean
    speak(text: string, language: Language, voice?: Voice): Effect.Effect<string, TtsError>
  }
>()("@kotori/backend/Speech") {
  static readonly layer = Layer.effect(
    Speech,
    Effect.gen(function* () {
      const pronouncer = yield* Pronouncer
      const store = yield* AudioStore
      const db = yield* Database
      const budget = yield* Config.Int("KOTORI_AUDIO_MONTHLY_CHARS").pipe(
        Config.withDefault(DEFAULT_AUDIO_MONTHLY_CHARS)
      )

      const keyFor = (text: string, language: Language, providerId: string) =>
        createHash("sha256").update([providerId, pronouncer.model, language, text].join("\n")).digest("hex")

      const speak = Effect.fn("Speech.speak")(function* (text: string, language: Language, voice?: Voice) {
        const reader = voice ?? (yield* pronouncer.defaultVoice(language))
        if (reader.providerId === null) {
          return yield* new TtsError({ reason: "unconfigured", message: `${reader.id} has no provider voice yet` })
        }
        const normalized = text.trim()
        const key = keyFor(normalized, language, reader.providerId)
        const cached = yield* findAudio(db, key)
        if (Option.isSome(cached) && (yield* store.exists(key))) return key

        const now = yield* Clock.currentTimeMillis
        const used = yield* audioCharactersSince(db, new Date(now - AUDIO_BUDGET_WINDOW))
        if (used + normalized.length > budget) {
          return yield* new TtsError({
            reason: "quota",
            message: `Monthly audio budget of ${budget} characters reached (KOTORI_AUDIO_MONTHLY_CHARS)`
          })
        }

        const bytes = yield* pronouncer.synthesize(normalized, language, reader)
        // Insert audio before store.put because audio_files has a foreign key to audio.key.
        yield* saveAudio(db, {
          key,
          text: normalized,
          language,
          voiceId: reader.providerId,
          voice: reader.id,
          modelId: pronouncer.model,
          characters: normalized.length,
          bytes: bytes.byteLength,
          createdAt: new Date(now)
        })
        yield* store.put(key, bytes)
        return key
      })

      return Speech.of({ configured: pronouncer.configured, speak })
    })
  )
}
