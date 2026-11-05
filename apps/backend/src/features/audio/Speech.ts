import { Pronouncer, TtsError, type Voice } from "@kotori/ai"
import type { Language } from "@kotori/contracts"
import type { UserId } from "@kotori/db"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { AudioStore } from "./AudioStore.ts"
import { audioCharactersSince, findAudio, saveAudio } from "./queries.ts"

export const AUDIO_BUDGET_WINDOW = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_AUDIO_MONTHLY_CHARS = 500_000
/** One learner's share of the monthly budget, so no one learner can spend all of it. */
export const DEFAULT_AUDIO_USER_MONTHLY_CHARS = 50_000

export interface SpeakOptions {
  /** By default the language's first dictionary voice. */
  readonly voice?: Voice | undefined
  /** The learner the clip is made for: it counts toward their monthly share as well as the budget. */
  readonly payer?: UserId | null | undefined
}

/**
 * Kotori's library of speech clips. A clip is content-addressed by voice, model, language and
 * text, so the same phrase is never paid for twice; new ones are made only while the month's
 * character budget lasts, and the learner it's made for has some of their share left.
 */
export class Speech extends Context.Service<
  Speech,
  {
    readonly configured: boolean
    /**
     * The audio key for `text` read by `voice` (by default the language's first dictionary
     * voice), synthesising it only if that voice hasn't spoken it yet.
     */
    speak(text: string, language: Language, options?: SpeakOptions): Effect.Effect<string, TtsError>
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

      const share = yield* Config.Int("KOTORI_AUDIO_USER_MONTHLY_CHARS").pipe(
        Config.withDefault(DEFAULT_AUDIO_USER_MONTHLY_CHARS)
      )

      const speak = Effect.fn("Speech.speak")(function* (text: string, language: Language, options?: SpeakOptions) {
        const payer = options?.payer ?? null
        const reader = options?.voice ?? (yield* pronouncer.defaultVoice(language))
        if (reader.providerId === null) {
          return yield* new TtsError({ reason: "unconfigured", message: `${reader.id} has no provider voice yet` })
        }
        const normalized = text.trim()
        const key = keyFor(normalized, language, reader.providerId)
        const cached = yield* findAudio(db, key)
        if (Option.isSome(cached) && (yield* store.exists(key))) return key

        const now = yield* Clock.currentTimeMillis
        const since = new Date(now - AUDIO_BUDGET_WINDOW)
        const used = yield* audioCharactersSince(db, since)
        if (used + normalized.length > budget) {
          return yield* new TtsError({
            reason: "quota",
            message: `Monthly audio budget of ${budget} characters reached (KOTORI_AUDIO_MONTHLY_CHARS)`
          })
        }
        if (payer !== null && (yield* audioCharactersSince(db, since, payer)) + normalized.length > share) {
          return yield* new TtsError({
            reason: "quota",
            message: `A learner's monthly audio share of ${share} characters reached (KOTORI_AUDIO_USER_MONTHLY_CHARS)`
          })
        }

        const bytes = yield* pronouncer.synthesize(normalized, language, reader)
        // The clip's row first: `audio_files` references it.
        yield* saveAudio(db, {
          key,
          text: normalized,
          language,
          voiceId: reader.providerId,
          voice: reader.id,
          modelId: pronouncer.model,
          characters: normalized.length,
          bytes: bytes.byteLength,
          userId: payer,
          createdAt: new Date(now)
        })
        yield* store.put(key, bytes)
        return key
      })

      return Speech.of({ configured: pronouncer.configured, speak })
    })
  )
}
