import type { ChoiceQuestion } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import type { Jev, JevError } from "./Jev.ts"

/**
 * Jev as the voice-casting tiebreaker. The deterministic selector
 * (@kotori/tts `rank`/`tied`) narrows the cast; when several voices score
 * level, one cheap Jev choice question picks the one that sounds most like
 * the person who would really say the sentence. Candidates arrive as id and
 * description pairs so this module needs nothing from the voice domain.
 */

export interface VoiceCandidate {
  /** Kotori voice id, e.g. "ja-casual-m"; becomes the choice label. */
  readonly id: string
  /** One line on how the voice sounds and when to use it, from the cast. */
  readonly description: string
}

export interface CastVote {
  readonly voiceId: string
  readonly confidence: number
}

/** Below this, Jev's pick is kept but logged, so weak calls show up when reviewing casting. */
export const CAST_CONFIDENCE_FLOOR = 0.4

const castingQuestion = (candidates: ReadonlyArray<VoiceCandidate>): ChoiceQuestion => ({
  type: "choice",
  instructions:
    "Which voice should read the sentence in `sentence` aloud (its translation is in `meaning`) so it sounds like the person who would really say it? Consider who is speaking, to whom, and how.",
  criteria: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.description]))
})

/**
 * Jev's pick among voices the selector could not separate. A single candidate
 * is returned as-is without paying for a Jev call — there is nothing to break —
 * and no candidates is a defect: the selector guarantees at least one.
 */
export const castVoice = (
  jev: Jev["Service"],
  input: { sentence: string; meaning: string; candidates: ReadonlyArray<VoiceCandidate> }
): Effect.Effect<CastVote, JevError> => {
  const [first, second] = input.candidates
  if (first === undefined) return Effect.die(new Error("castVoice needs at least one candidate"))
  if (second === undefined) return Effect.succeed({ voiceId: first.id, confidence: 1 })
  return jev
    .ask({ sentence: input.sentence, meaning: input.meaning }, { voice: castingQuestion(input.candidates) })
    .pipe(
      Effect.map(({ answers }) => ({ voiceId: answers.voice.choice, confidence: answers.voice.confidence })),
      Effect.withSpan("castVoice", { attributes: { candidates: input.candidates.length } })
    )
}
