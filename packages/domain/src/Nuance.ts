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

export const Nuance = Schema.Struct({
  formality: scale(Formality),
  medium: scale(Medium),
  keigo: judgment(Keigo),
  gender: judgment(Gender),
  age: judgment(AgeGroup),
  currency: judgment(Currency),
  connotation: judgment(Connotation),
  /** Probabilities of common pitfalls for learners. */
  cautions: Schema.Struct({
    rudeToSuperiors: Schema.Number,
    stiffWithFriends: Schema.Number,
    slang: Schema.Number
  })
})
export type Nuance = typeof Nuance.Type

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
