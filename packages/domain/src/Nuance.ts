import * as Schema from "effect/Schema"

/** How formal a word or sentence sounds, from crude to ceremonious. */
export const Formality = Schema.Literals(["vulgar", "casual", "neutral", "polite", "formal"])
export type Formality = typeof Formality.Type

/** Japanese honorific language (敬語). */
export const Keigo = Schema.Literals(["none", "teineigo", "sonkeigo", "kenjougo", "bikago"])
export type Keigo = typeof Keigo.Type

/** Whether a word lives mostly in conversation, in writing, or both. */
export const Medium = Schema.Literals(["spoken", "both", "written"])
export type Medium = typeof Medium.Type

export const Gender = Schema.Literals(["neutral", "masculine", "feminine"])
export type Gender = typeof Gender.Type

export const AgeGroup = Schema.Literals(["any", "children", "youth", "older"])
export type AgeGroup = typeof AgeGroup.Type

/** How current a word feels. */
export const Currency = Schema.Literals(["archaic", "dated", "current", "trendy"])
export type Currency = typeof Currency.Type

export const Connotation = Schema.Literals(["negative", "neutral", "positive"])
export type Connotation = typeof Connotation.Type

/**
 * Where a judgment came from: a dictionary tag (authoritative), JMDict's or the English
 * dictionary's in JMDict's codes, or Jev's classification.
 */
export const JudgmentSource = Schema.Literals(["jmdict", "jev"])
export type JudgmentSource = typeof JudgmentSource.Type

const judgment = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    value,
    confidence: Schema.Number,
    source: JudgmentSource
  })

const scale = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    value,
    /** 0..1 position along the scale, for meters. */
    position: Schema.Number,
    confidence: Schema.Number,
    source: JudgmentSource
  })

/**
 * Whether a casual↔formal scale is the right model for the word at all:
 * scaled words move along it, fixed words sit at one obvious register
 * (insults, ceremonial words), split words live in two worlds at once
 * (clinical in one, crude or joking in the other).
 */
export const RegisterShape = Schema.Literals(["scaled", "fixed", "split"])
export type RegisterShape = typeof RegisterShape.Type

// --- Judged on English words only, for Japanese speakers learning them --------

/** Whose English a word is: everyone's, or mainly American or British. */
export const Variety = Schema.Literals(["universal", "american", "british"])
export type Variety = typeof Variety.Type

/** How offensive an English word is; "avoid" marks slurs and words learners should not use. */
export const Profanity = Schema.Literals(["none", "mild", "strong", "avoid"])
export type Profanity = typeof Profanity.Type

export const Nuance = Schema.Struct({
  formality: scale(Formality),
  medium: scale(Medium),
  /** English has no keigo: English words carry "none", from the dictionary. */
  keigo: judgment(Keigo),
  gender: judgment(Gender),
  age: judgment(AgeGroup),
  currency: judgment(Currency),
  connotation: judgment(Connotation),
  /** Absent on judgments stored before questions version 2. */
  registerShape: Schema.optional(judgment(RegisterShape)),
  /** Probabilities of common pitfalls for learners. */
  cautions: Schema.Struct({
    rudeToSuperiors: Schema.Number,
    stiffWithFriends: Schema.Number,
    slang: Schema.Number,
    /** English words: wording taught to learners that natives rarely use ("How do you do?"). */
    textbook: Schema.optional(Schema.Number)
  }),
  /** English words only. */
  variety: Schema.optional(judgment(Variety)),
  /** English words only. */
  profanity: Schema.optional(judgment(Profanity))
})
export type Nuance = typeof Nuance.Type

/**
 * Whether a katakana loan means in everyday Japanese what its English word means (コーヒー,
 * coffee), has drifted, so a Japanese speaker carrying it over is misunderstood (スタイル is
 * first someone's figure), or wasn't borrowed from English at all (パン, from Portuguese).
 */
export const LoanMeaning = Schema.Literals(["same", "divergent", "not_english"])
export type LoanMeaning = typeof LoanMeaning.Type

/** Jev's verdict on a loan: its likeliest meaning, and how likely that is. */
export const LoanVerdict = Schema.Struct({
  value: LoanMeaning,
  /** Jev's probability of `value`, not its confidence, which measures how peaked the answer is. */
  probability: Schema.Number,
  source: JudgmentSource
})
export type LoanVerdict = typeof LoanVerdict.Type

/** The katakana loan of an English word, which Japanese speakers already think they know. */
export const Loanword = Schema.Struct({
  /** The katakana word, as JMDict spells it. */
  word: Schema.String,
  verdict: LoanVerdict,
  /** Claude's one Japanese sentence on how the words differ, once the loan is shown diverging. */
  trap: Schema.NullOr(Schema.String)
})
export type Loanword = typeof Loanword.Type

/**
 * How likely a loan's meaning must be for the app to show it: the docs' starting point for acting
 * on an answer, and for a three-option Choice the app's 0.55 confidence for its other judgments.
 */
export const LOAN_SHOWN = 0.7

/**
 * What the app shows for a loan verdict, and so whether Claude writes its warning: a warning at
 * p(divergent) ≥ 0.7, a "same meaning" chip at p(same) ≥ 0.7, and nothing for an unsure verdict
 * or a loan Jev judges not English (docs/nuance-on-english-entries.md).
 */
export const loanShown = (verdict: LoanVerdict): "warning" | "chip" | null =>
  verdict.probability < LOAN_SHOWN
    ? null
    : verdict.value === "divergent"
      ? "warning"
      : verdict.value === "same"
        ? "chip"
        : null

/** How a similar word differs from the one being looked at. */
export const Difference = Schema.Literals([
  "more_casual",
  "more_formal",
  "more_literary",
  "more_colloquial",
  "respectful",
  "humble",
  "more_specific",
  "more_general",
  "different_feeling",
  "different_usage"
])
export type Difference = typeof Difference.Type
