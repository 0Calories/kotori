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

/** The curated voices in use; defaults to the checked-in casts, overridden in tests. */
export const VoiceCasts = Context.Reference<Casts>("@kotori/ai/VoiceCasts", {
  defaultValue: () => CASTS
})

/** An example sentence as casting reads it: both sides, its formality and its speaker signals. */
export interface CastingSentence extends SentenceSignals {
  /** For logs. */
  readonly id: number
  readonly ja: string
  readonly en: string
}

/** The chosen reader of one clip, and how the choice was made: scoring alone, or Jev breaking a tie. */
export interface CastingDecision {
  readonly voice: Voice
  readonly castBy: "rules" | "jev"
  readonly score: number
}

/**
 * Speech for Kotori's curated voices: who reads what, and the synthesis itself. Stateless; the
 * caller keeps the clips, pays attention to the budget and decides what still needs voicing.
 */
export class Pronouncer extends Context.Service<
  Pronouncer,
  {
    readonly configured: boolean
    /** The synthesis model; clips are told apart by it, so a new model voices them anew. */
    readonly model: string
    /** The language's dictionary voices, in casting order: who reads headwords. */
    headwordVoices(language: Language): ReadonlyArray<Voice>
    /** Who reads text when nobody is chosen: the language's first dictionary voice. */
    defaultVoice(language: Language): Effect.Effect<Voice, TtsError>
    /** `text` read aloud by `voice`, as MP3 bytes. */
    synthesize(text: string, language: Language, voice: Voice): Effect.Effect<Uint8Array, TtsError>
    /**
     * The voice that reads one side of an example. Scoring decides alone when it can; Jev breaks
     * ties when it is configured, and any Jev problem falls back to the top score. None when the
     * language has nobody cast who could read it.
     */
    cast(
      sentence: CastingSentence,
      sense: SenseSignals,
      language: Language
    ): Effect.Effect<Option.Option<CastingDecision>>
    /** Whether `judge` can run: Jev is configured. Without it, seeded sentences stay unvoiced. */
    readonly judges: boolean
    /**
     * The formality and speaker signals of sentences nobody judged as they were written (those
     * seeded from Tatoeba and Wiktionary), in `language`, all in one or a few Jev requests.
     */
    judge(
      language: Language,
      sentences: ReadonlyArray<SentenceToJudge>
    ): Effect.Effect<ReadonlyArray<JudgedCasting>, JevError>
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
        // A brief may ask for a variety nobody is cast in yet (see docs/voice-casting.md);
        // the standard voices then read the sentence rather than nobody.
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
