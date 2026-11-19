import type { Casting, Formality, Language } from "@kotori/contracts"
import type { ChoiceQuestion } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { type Jev, JevDeadline, type JevError } from "../providers/Jev.ts"
import {
  CASTS,
  type Casts,
  DEFAULT_VARIETY,
  type Variety,
  type Voice,
  type VoiceAge,
  type VoiceMedium
} from "./voices.ts"

export interface CastingBrief {
  readonly variety: Variety | null
  readonly gender: "masculine" | "feminine" | null
  readonly age: VoiceAge | null
  readonly formality: Formality
  readonly medium: VoiceMedium | null
  readonly slang: boolean
  readonly archaic: boolean
  readonly humorous: boolean
}

export interface SentenceSignals extends Partial<Casting> {
  readonly formality: Formality
}

/** Must be the target sense's own labels (including Kotori fills), not entry-wide labels. */
export interface SenseSignals {
  readonly labels: ReadonlyArray<string>
  readonly fields: ReadonlyArray<string>
}

export interface CastingInput {
  readonly sentence: SentenceSignals
  readonly sense: SenseSignals
}

const DIALECT_VARIETIES: Record<string, Variety> = {
  ksb: "kansai",
  osb: "kansai",
  kyb: "kansai",
  thb: "tohoku",
  kyu: "kyushu",
  "en-US": "american",
  "en-GB": "british",
  "en-AU": "australian"
}

/** Excludes "col", which sentence formality already carries. */
const SLANG = new Set(["sl", "net-sl", "m-sl", "vulg"])

const ARCHAIC = new Set(["arch", "obs", "dated"])

const SENTENCE_VARIETIES: Record<string, Variety> = {
  kansai: "kansai",
  tohoku: "tohoku",
  kyushu: "kyushu",
  american: "american",
  british: "british",
  australian: "australian"
}

export const briefFor = ({ sense, sentence }: CastingInput): CastingBrief => {
  const labels = new Set(sense.labels)
  const sentenceVariety = sentence.variety == null ? null : (SENTENCE_VARIETIES[sentence.variety] ?? null)
  const senseVariety = sense.labels.map((code) => DIALECT_VARIETIES[code]).find((tag) => tag !== undefined) ?? null

  const speakerGender =
    sentence.speakerGender === "masculine" || sentence.speakerGender === "feminine" ? sentence.speakerGender : null
  const labelGender = labels.has("male") ? "masculine" : labels.has("fem") ? "feminine" : null

  const speakerAge = sentence.speakerAge != null && sentence.speakerAge !== "unspecified" ? sentence.speakerAge : null
  const labelAge = labels.has("chn") ? "child" : null

  const formalWriting = sentence.formality === "formal" && (labels.has("form") || sense.fields.length > 0)

  return {
    variety: sentenceVariety ?? senseVariety,
    gender: speakerGender ?? labelGender,
    age: speakerAge ?? labelAge,
    formality: sentence.formality,
    medium: sentence.medium ?? (formalWriting ? "announcement" : null),
    slang: sentence.formality === "vulgar" || sense.labels.some((code) => SLANG.has(code)),
    archaic: sense.labels.some((code) => ARCHAIC.has(code)),
    humorous: sentence.tone === "humorous"
  }
}

// Gender (±3) outweighs age and medium (+2) because a mismatched gendered ending is the most audible miscast after variety.
const GENDER_MATCH = 3
const GENDER_MISMATCH = -3
const GENDER_ANDROGYNOUS = 1
const AGE_EXACT = 2
const AGE_ADJACENT = 1
const AGE_MISMATCH = -1
const MEDIUM_MATCH = 2
const SLANG_FIT = 1
const ARCHAIC_FIT = 1
/** Beats an exact age match (+2) within the same gender without overriding gender (±3). */
const COMIC_FIT = 3
const FORMALITY_LISTED = 1
export const TIE_WINDOW = 1

const AGE_ORDER: ReadonlyArray<VoiceAge> = ["youth", "adult", "middle-aged", "older"]

const ageScore = (want: VoiceAge, has: VoiceAge): number => {
  if (want === has) return AGE_EXACT
  if (want === "child" || has === "child") return AGE_MISMATCH
  const distance = Math.abs(AGE_ORDER.indexOf(want) - AGE_ORDER.indexOf(has))
  return distance === 1 ? AGE_ADJACENT : AGE_MISMATCH
}

export interface RankedVoice<L extends Language = Language> {
  readonly voice: Voice<L>
  readonly score: number
}

export const rank = <L extends Language>(
  brief: CastingBrief,
  language: L,
  casts: Casts = CASTS
): ReadonlyArray<RankedVoice<L>> => {
  const variety = brief.variety ?? DEFAULT_VARIETY[language]
  const comic = (voice: Voice<L>) => brief.humorous && voice.tags.tone.includes("comic")
  const spoken = casts[language].filter(
    (voice) => voice.providerId !== null && (voice.tags.variety === variety || comic(voice))
  )
  const inRegister = spoken.filter((voice) => voice.tags.formality.includes(brief.formality))
  const candidates = inRegister.length > 0 ? inRegister : spoken

  return candidates
    .map((voice) => {
      let score = 0
      if (brief.gender !== null) {
        score +=
          voice.tags.gender === brief.gender
            ? GENDER_MATCH
            : voice.tags.gender === "androgynous"
              ? GENDER_ANDROGYNOUS
              : GENDER_MISMATCH
      }
      if (brief.age !== null) score += ageScore(brief.age, voice.tags.age)
      if (brief.medium !== null && voice.tags.medium.includes(brief.medium)) score += MEDIUM_MATCH
      if (brief.slang && (voice.tags.formality.includes("vulgar") || voice.tags.formality.includes("casual"))) {
        score += SLANG_FIT
      }
      // Older only: a narration bonus here would double-count the medium match.
      if (brief.archaic && voice.tags.age === "older") score += ARCHAIC_FIT
      if (comic(voice)) score += COMIC_FIT
      if (voice.tags.formality.includes(brief.formality)) score += FORMALITY_LISTED
      return { voice, score }
    })
    .sort((a, b) => b.score - a.score)
}

export const tied = <L extends Language>(ranked: ReadonlyArray<RankedVoice<L>>): ReadonlyArray<RankedVoice<L>> =>
  ranked.length === 0 ? [] : ranked.filter(({ score }) => ranked[0]!.score - score <= TIE_WINDOW)

export interface VoiceCandidate {
  readonly id: string
  readonly description: string
}

export interface CastVote {
  readonly voiceId: string
  readonly confidence: number
}

export const CAST_CONFIDENCE_FLOOR = 0.4

const castingQuestion = (candidates: ReadonlyArray<VoiceCandidate>): ChoiceQuestion => ({
  type: "choice",
  instructions:
    "Which voice should read the sentence in `sentence` aloud (its translation is in `meaning`) so it sounds like the person who would really say it? Consider who is speaking, to whom, and how.",
  criteria: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.description]))
})

export const castVoice = (
  jev: Jev["Service"],
  input: { sentence: string; meaning: string; candidates: ReadonlyArray<VoiceCandidate> }
): Effect.Effect<CastVote, JevError> => {
  const [first, second] = input.candidates
  if (first === undefined) return Effect.die(new Error("castVoice needs at least one candidate"))
  if (second === undefined) return Effect.succeed({ voiceId: first.id, confidence: 1 })
  return jev
    .ask(
      { sentence: input.sentence, meaning: input.meaning },
      { voice: castingQuestion(input.candidates) },
      { timeout: JevDeadline.bulk }
    )
    .pipe(
      Effect.map(({ answers }) => ({ voiceId: answers.voice.choice, confidence: answers.voice.confidence })),
      Effect.withSpan("castVoice", { attributes: { candidates: input.candidates.length } })
    )
}
