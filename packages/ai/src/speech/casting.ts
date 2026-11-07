import type { Casting, Formality, Language } from "@kotori/contracts"
import type { ChoiceQuestion } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import type { Jev, JevError } from "../providers/Jev.ts"
import {
  CASTS,
  type Casts,
  DEFAULT_VARIETY,
  type Variety,
  type Voice,
  type VoiceAge,
  type VoiceMedium
} from "./voices.ts"

/**
 * Picks the voice that fits a sentence. Pure: `briefFor` merges the stored
 * signals into one language-neutral casting brief, `rank` scores a language's
 * cast against it. Ties (within TIE_WINDOW of the top) are broken by Jev elsewhere.
 */

/**
 * A casting brief: the kind of speaker a sentence calls for, independent of
 * language. Derived once per sentence and used to cast both its Japanese and
 * its English clip, so the two land on matching speakers.
 */
export interface CastingBrief {
  /** Hard requirement; null means the language's default variety. */
  readonly variety: Variety | null
  readonly gender: "masculine" | "feminine" | null
  readonly age: VoiceAge | null
  readonly formality: Formality
  readonly medium: VoiceMedium | null
  readonly slang: boolean
  readonly archaic: boolean
  /** A joke or comic line: comic voices may read it whatever its variety. */
  readonly humorous: boolean
}

/**
 * The sentence signals casting reads: its formality, and its `Casting` spread beside it (absent
 * on examples written before casting). A variety is the label Claude wrote ("kansai", "british"…).
 */
export interface SentenceSignals extends Partial<Casting> {
  readonly formality: Formality
}

/**
 * What the sentence's own sense says about its speaker: all of the sense's labels, whatever
 * their source (a dictionary's, or Kotori's fill), and its subject fields. Not the word's labels,
 * which are only those every sense shares.
 */
export interface SenseSignals {
  readonly labels: ReadonlyArray<string>
  readonly fields: ReadonlyArray<string>
}

export interface CastingInput {
  readonly sentence: SentenceSignals
  readonly sense: SenseSignals
}

/**
 * Dialect and region labels on a sense → the variety a voice must have: JMDict's dialects for
 * Japanese words, regions of English for English ones. Codes without one stay default.
 */
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

/** Labels that mark slang, which a casual or rough voice reads best; colloquial is a register, carried by formality. */
const SLANG = new Set(["sl", "net-sl", "m-sl", "vulg"])

/** Labels that mark a word as old, which an older voice reads best. */
const ARCHAIC = new Set(["arch", "obs", "dated"])

/** Sentence variety labels (free-form from Claude) → varieties. */
const SENTENCE_VARIETIES: Record<string, Variety> = {
  kansai: "kansai",
  tohoku: "tohoku",
  kyushu: "kyushu",
  american: "american",
  british: "british",
  australian: "australian"
}

/** Writes the casting brief for a sentence, merging its signals most specific first: the sentence's, then its sense's labels. */
export const briefFor = ({ sense, sentence }: CastingInput): CastingBrief => {
  const labels = new Set(sense.labels)
  const sentenceVariety = sentence.variety == null ? null : (SENTENCE_VARIETIES[sentence.variety] ?? null)
  const senseVariety = sense.labels.map((code) => DIALECT_VARIETIES[code]).find((tag) => tag !== undefined) ?? null

  const speakerGender =
    sentence.speakerGender === "masculine" || sentence.speakerGender === "feminine" ? sentence.speakerGender : null
  const labelGender = labels.has("male") ? "masculine" : labels.has("fem") ? "feminine" : null

  const speakerAge = sentence.speakerAge != null && sentence.speakerAge !== "unspecified" ? sentence.speakerAge : null
  const labelAge = labels.has("chn") ? "child" : null

  // A formal line of a formal written word (Kotori's `form` fill) or a field's term is read as an announcement.
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

// Scoring weights. Gender outranks everything soft because a mismatched speaker
// (a man voicing わ-speech) is the most audible miscast after variety; age and
// medium shape the scene; the rest nudge. Tune these from `regen --dry-run`.
const GENDER_MATCH = 3
const GENDER_MISMATCH = -3
const GENDER_ANDROGYNOUS = 1
const AGE_EXACT = 2
const AGE_ADJACENT = 1
const AGE_MISMATCH = -1
const MEDIUM_MATCH = 2
const SLANG_FIT = 1
const ARCHAIC_FIT = 1
/** Enough to beat a same-gender voice that matches age exactly, so a comic line goes to a comic voice. */
const COMIC_FIT = 3
const FORMALITY_LISTED = 1
/** Voices within this of the top score are considered tied and go to Jev. */
export const TIE_WINDOW = 1

/** Adults by age; a child has no neighbour, so an adult voice never passes for one. */
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

/**
 * The cast voices of `language` that may read the sentence, best fit first.
 * Variety is a hard filter, except that a humorous brief also admits comic
 * voices of any variety; the register filter is relaxed rather than return
 * nobody, so there is always at least one candidate when the language is cast.
 */
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

/** The top voices that scoring could not separate; more than one means Jev decides. */
export const tied = <L extends Language>(ranked: ReadonlyArray<RankedVoice<L>>): ReadonlyArray<RankedVoice<L>> =>
  ranked.length === 0 ? [] : ranked.filter(({ score }) => ranked[0]!.score - score <= TIE_WINDOW)

// --- Jev as the tiebreaker ---------------------------------------------------------
//
// `rank` and `tied` narrow the cast; when several voices score level, one cheap Jev choice
// question picks the one that sounds most like the person who would really say the sentence.

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
