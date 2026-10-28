import type { Formality, Language, Nuance } from "@kotori/domain"
import type { Voice, VoiceAge, VoiceDialect, VoiceMedium } from "./voices.ts"

/**
 * Picks the voice that fits a sentence. Pure: `wanted` merges the stored
 * signals into one language-neutral profile, `rank` scores a language's cast
 * against it. Ties (within TIE_WINDOW of the top) are broken by Jev elsewhere.
 */

/** What the sentence asks of a voice, derived once and used for every language. */
export interface Wanted {
  /** Hard requirement; null means the language's standard variety. */
  readonly dialect: VoiceDialect | null
  readonly gender: "masculine" | "feminine" | null
  readonly age: VoiceAge | null
  readonly formality: Formality
  readonly medium: VoiceMedium | null
  readonly slang: boolean
  readonly archaic: boolean
}

/** The sentence columns casting reads; all but formality land with the examples migration. */
export interface SentenceSignals {
  readonly formality: Formality
  readonly speakerGender?: "masculine" | "feminine" | "unspecified" | null
  readonly speakerAge?: "child" | "youth" | "adult" | "middle-aged" | "older" | "unspecified" | null
  readonly medium?: VoiceMedium | null
  readonly dialect?: string | null
}

export interface SenseSignals {
  readonly misc: ReadonlyArray<string>
  readonly dialects: ReadonlyArray<string>
  readonly fields: ReadonlyArray<string>
}

export interface CastingInput {
  readonly sentence: SentenceSignals
  readonly sense: SenseSignals
  readonly nuance: Nuance | null
}

/** JMDict dial codes → voice dialect tags. Codes without a cast dialect stay standard. */
const JMDICT_DIALECTS: Record<string, VoiceDialect> = {
  ksb: "kansai",
  osb: "kansai",
  kyb: "kansai",
  thb: "tohoku",
  kyu: "kyushu"
}

/** Sentence dialect labels (free-form from Claude) → voice dialect tags. */
const SENTENCE_DIALECTS: Record<string, VoiceDialect> = {
  kansai: "kansai",
  tohoku: "tohoku",
  kyushu: "kyushu",
  american: "american",
  british: "british",
  australian: "australian"
}

/** Below this, a Jev nuance judgment is too unsure to steer casting. */
const NUANCE_CONFIDENCE = 0.6

const nuanceGender = (nuance: Nuance | null): Wanted["gender"] =>
  nuance !== null &&
  nuance.gender.confidence >= NUANCE_CONFIDENCE &&
  (nuance.gender.value === "masculine" || nuance.gender.value === "feminine")
    ? nuance.gender.value
    : null

const nuanceAge = (nuance: Nuance | null): VoiceAge | null => {
  if (nuance === null || nuance.age.confidence < NUANCE_CONFIDENCE) return null
  switch (nuance.age.value) {
    case "children":
      return "child"
    case "youth":
      return "youth"
    case "older":
      return "older"
    default:
      return null
  }
}

/** Merges sentence, JMDict and nuance signals, most specific first. */
export const wanted = ({ nuance, sense, sentence }: CastingInput): Wanted => {
  const sentenceDialect = sentence.dialect == null ? null : (SENTENCE_DIALECTS[sentence.dialect] ?? null)
  const senseDialect = sense.dialects.map((code) => JMDICT_DIALECTS[code]).find((tag) => tag !== undefined) ?? null

  const speakerGender =
    sentence.speakerGender === "masculine" || sentence.speakerGender === "feminine" ? sentence.speakerGender : null
  const miscGender = sense.misc.includes("male") ? "masculine" : sense.misc.includes("fem") ? "feminine" : null

  const speakerAge = sentence.speakerAge != null && sentence.speakerAge !== "unspecified" ? sentence.speakerAge : null
  const miscAge = sense.misc.includes("chn") ? "child" : null

  const formalWriting =
    sentence.formality === "formal" &&
    ((nuance !== null && nuance.medium.value === "written") || sense.fields.length > 0)

  return {
    dialect: sentenceDialect ?? senseDialect,
    gender: speakerGender ?? miscGender ?? nuanceGender(nuance),
    age: speakerAge ?? miscAge ?? nuanceAge(nuance),
    formality: sentence.formality,
    medium: sentence.medium ?? (formalWriting ? "announcement" : null),
    slang:
      sentence.formality === "vulgar" ||
      sense.misc.includes("sl") ||
      sense.misc.includes("vulg") ||
      (nuance !== null && nuance.cautions.slang >= NUANCE_CONFIDENCE),
    archaic:
      sense.misc.includes("arch") ||
      sense.misc.includes("dated") ||
      (nuance !== null &&
        nuance.currency.confidence >= NUANCE_CONFIDENCE &&
        (nuance.currency.value === "archaic" || nuance.currency.value === "dated"))
  }
}

/** The regional variety a sentence without a dialect label is read in. */
const STANDARD_DIALECT: Record<Language, VoiceDialect> = { ja: "standard", en: "american" }

// Scoring weights. Gender outranks everything soft because a mismatched speaker
// (a man voicing わ-speech) is the most audible miscast after dialect; age and
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
const FORMALITY_LISTED = 1
/** Voices within this of the top score are considered tied and go to Jev. */
export const TIE_WINDOW = 1

const AGE_ORDER: ReadonlyArray<VoiceAge> = ["child", "youth", "adult", "middle-aged", "older"]

const ageScore = (want: VoiceAge, has: VoiceAge): number => {
  if (want === has) return AGE_EXACT
  const distance = Math.abs(AGE_ORDER.indexOf(want) - AGE_ORDER.indexOf(has))
  return distance === 1 ? AGE_ADJACENT : AGE_MISMATCH
}

export interface RankedVoice {
  readonly voice: Voice
  readonly score: number
}

/**
 * The voices of `language` that may read the sentence, best fit first.
 * Dialect is a hard filter; the register filter is relaxed rather than return
 * nobody, so there is always at least one candidate when the language is cast.
 */
export const rank = (want: Wanted, cast: ReadonlyArray<Voice>, language: Language): ReadonlyArray<RankedVoice> => {
  const spoken = cast.filter(
    (voice) =>
      voice.language === language &&
      voice.providerId !== null &&
      voice.tags.dialect === (want.dialect ?? STANDARD_DIALECT[language])
  )
  const inRegister = spoken.filter((voice) => voice.tags.formality.includes(want.formality))
  const candidates = inRegister.length > 0 ? inRegister : spoken

  return candidates
    .map((voice) => {
      let score = 0
      if (want.gender !== null) {
        score +=
          voice.tags.gender === want.gender
            ? GENDER_MATCH
            : voice.tags.gender === "androgynous"
              ? GENDER_ANDROGYNOUS
              : GENDER_MISMATCH
      }
      if (want.age !== null) score += ageScore(want.age, voice.tags.age)
      if (want.medium !== null && voice.tags.medium.includes(want.medium)) score += MEDIUM_MATCH
      if (want.slang && (voice.tags.formality.includes("vulgar") || voice.tags.formality.includes("casual"))) {
        score += SLANG_FIT
      }
      // Older only: a narration bonus here would double-count the medium match.
      if (want.archaic && voice.tags.age === "older") score += ARCHAIC_FIT
      if (voice.tags.formality.includes(want.formality)) score += FORMALITY_LISTED
      return { voice, score }
    })
    .sort((a, b) => b.score - a.score)
}

/** The top voices that scoring could not separate; more than one means Jev decides. */
export const tied = (ranked: ReadonlyArray<RankedVoice>): ReadonlyArray<RankedVoice> =>
  ranked.length === 0 ? [] : ranked.filter(({ score }) => ranked[0]!.score - score <= TIE_WINDOW)
