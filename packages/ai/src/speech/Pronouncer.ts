import type { Language } from "@kotori/contracts"
import { Context, Effect, Layer, Option } from "effect"
import { ElevenLabs, TtsError } from "../providers/ElevenLabs.ts"
import { Jev, type JevError } from "../providers/Jev.ts"
import {
  briefFor,
  CAST_CONFIDENCE_FLOOR,
  type CastingBrief,
  castVoice,
  rank,
  type RankedVoice,
  type SenseSignals,
  type SentenceSignals,
  tied
} from "./casting.ts"
import { type JudgedCasting, judgeCasting, type SentenceToJudge } from "./judge.ts"
import { CASTS, type Casts, headwordVoices, type Voice } from "./voices.ts"

export const VoiceCasts = Context.Reference<Casts>("@kotori/ai/VoiceCasts", {
  defaultValue: () => CASTS
})

export interface CastingSentence extends SentenceSignals {
  readonly id: number
  readonly ja: string
  readonly en: string
}

export interface CastingDecision {
  readonly voice: Voice
  readonly castBy: "rules" | "jev"
  readonly score: number
}

export class Pronouncer extends Context.Service<
  Pronouncer,
  {
    readonly configured: boolean
    readonly model: string
    headwordVoices(language: Language): ReadonlyArray<Voice>
    defaultVoice(language: Language): Effect.Effect<Voice, TtsError>
    synthesize(text: string, language: Language, voice: Voice): Effect.Effect<Uint8Array, TtsError>
    cast(
      sentence: CastingSentence,
      sense: SenseSignals,
      language: Language
    ): Effect.Effect<Option.Option<CastingDecision>>
    readonly judges: boolean
    judge(
      language: Language,
      sentences: ReadonlyArray<SentenceToJudge>
    ): Effect.Effect<ReadonlyArray<JudgedCasting | null>, JevError>
  }
>()("@kotori/ai/Pronouncer") {
  static readonly layer = Layer.effect(
    Pronouncer,
    Effect.gen(function* () {
      const tts = yield* ElevenLabs
      const jev = yield* Jev
      const casts = yield* VoiceCasts

      const defaultVoice = (language: Language): Effect.Effect<Voice, TtsError> => {
        const voice = headwordVoices(language, casts)[0]
        return voice === undefined
          ? Effect.fail(
              new TtsError({ reason: "unconfigured", message: `No dictionary voice is cast for ${language}` })
            )
          : Effect.succeed(voice)
      }

      const synthesize = (text: string, language: Language, voice: Voice) =>
        voice.providerId === null
          ? Effect.fail(new TtsError({ reason: "unconfigured", message: `${voice.id} has no provider voice yet` }))
          : tts.synthesize(text, language, voice.providerId)

      const cast = Effect.fn("Pronouncer.cast")(function* (
        sentence: CastingSentence,
        sense: SenseSignals,
        language: Language
      ) {
        const brief: CastingBrief = briefFor({ sentence, sense })
        // Some varieties in VARIETIES have no cast voice yet, so fall back to the language's default variety.
        let ranked: ReadonlyArray<RankedVoice> = rank(brief, language, casts)
        if (ranked.length === 0) ranked = rank({ ...brief, variety: null }, language, casts)
        const top = ranked[0]
        if (top === undefined) {
          yield* Effect.logWarning(`No ${language} voice is cast for example ${sentence.id}; skipping its audio`)
          return Option.none<CastingDecision>()
        }

        const ties = tied(ranked)
        const byRules: CastingDecision = { voice: top.voice, castBy: "rules", score: top.score }
        if (ties.length < 2 || !jev.configured) return Option.some(byRules)

        const vote = yield* castVoice(jev, {
          sentence: language === "ja" ? sentence.ja : sentence.en,
          meaning: language === "ja" ? sentence.en : sentence.ja,
          candidates: ties.map(({ voice }) => ({ id: voice.id, description: voice.description }))
        }).pipe(Effect.option)
        if (Option.isNone(vote)) {
          yield* Effect.logWarning(`castVoice failed for example ${sentence.id} (${language}); using the top score`)
          return Option.some(byRules)
        }
        if (vote.value.confidence < CAST_CONFIDENCE_FLOOR) {
          yield* Effect.logInfo(
            `castVoice picked ${vote.value.voiceId} for example ${sentence.id} (${language}) at low confidence ${vote.value.confidence}`
          )
        }
        const chosen = ties.find(({ voice }) => voice.id === vote.value.voiceId)
        if (chosen === undefined) {
          yield* Effect.logWarning(
            `castVoice picked ${vote.value.voiceId} outside the tie for example ${sentence.id} (${language}); using the top score`
          )
          return Option.some(byRules)
        }
        return Option.some<CastingDecision>({ voice: chosen.voice, castBy: "jev", score: chosen.score })
      })

      return Pronouncer.of({
        configured: tts.configured,
        model: tts.model,
        headwordVoices: (language) => headwordVoices(language, casts),
        defaultVoice,
        synthesize,
        cast,
        judges: jev.configured,
        judge: (language, sentences) => judgeCasting(jev, language, sentences)
      })
    })
  )
}
