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

/** Where a judgment came from: a JMDict tag (authoritative) or Jev's classification. */
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

export const Nuance = Schema.Struct({
  formality: scale(Formality),
  medium: scale(Medium),
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
    slang: Schema.Number
  })
})
export type Nuance = typeof Nuance.Type

// --- The English side of a sense, for Japanese natives learning English -----

export const EnglishVariety = Schema.Literals(["universal", "american", "british"])
export type EnglishVariety = typeof EnglishVariety.Type

/** How offensive the English word is; "avoid" marks slurs and words learners should not use. */
export const EnglishStrength = Schema.Literals(["none", "mild", "strong", "avoid"])
export type EnglishStrength = typeof EnglishStrength.Type

/** "textbook" marks wording taught to learners that natives rarely use. */
export const EnglishCurrency = Schema.Literals(["current", "dated", "textbook"])
export type EnglishCurrency = typeof EnglishCurrency.Type

export const EnglishRegister = Schema.Literals(["casual", "neutral", "formal"])
export type EnglishRegister = typeof EnglishRegister.Type

/**
 * Whether a common katakana loanword corresponds to the English word, and whether
 * its everyday Japanese meaning matches this sense (スタイル means figure, not style).
 */
export const LoanVerdict = Schema.Literals(["no_loan", "matches", "diverges"])
export type LoanVerdict = typeof LoanVerdict.Type

/** Jev's judgments of the English side, stored as judged. */
export const EnglishJudgments = Schema.Struct({
  variety: judgment(EnglishVariety),
  strength: judgment(EnglishStrength),
  currency: judgment(EnglishCurrency),
  register: judgment(EnglishRegister),
  loan: judgment(LoanVerdict)
})
export type EnglishJudgments = typeof EnglishJudgments.Type

/** The English-side nuance shown to Japanese natives: the judgments plus Claude's loanword prose. */
export const EnglishNuance = Schema.Struct({
  ...EnglishJudgments.fields,
  /** The katakana loanword, named by Claude when the loan verdict diverges. */
  loanWord: Schema.NullOr(Schema.String),
  /** One Japanese sentence on how the English word differs from the katakana word. */
  loanTrap: Schema.NullOr(Schema.String)
})
export type EnglishNuance = typeof EnglishNuance.Type

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
