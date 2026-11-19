import * as Schema from "effect/Schema"
import { EntryId } from "./Dictionary.ts"

export const Register = Schema.Literals(["casual", "neutral", "polite", "formal"])
export type Register = typeof Register.Type

const Text = (maxLength: number) =>
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(maxLength)))

export const NaturalnessRequest = Schema.Struct({
  text: Text(400),
  context: Schema.optional(Text(400)),
  intent: Schema.optional(Text(400))
})
export type NaturalnessRequest = typeof NaturalnessRequest.Type

export const Verdict = Schema.Literals(["natural", "understandable", "unnatural", "incorrect"])
export type Verdict = typeof Verdict.Type

export const IssueKind = Schema.Literals([
  "grammar",
  "particle",
  "word_choice",
  "register",
  "phrasing",
  "spelling",
  "other"
])
export type IssueKind = typeof IssueKind.Type

export const Issue = Schema.Struct({
  excerpt: Schema.String,
  kind: IssueKind,
  explanation: Schema.String,
  fix: Schema.String
})
export type Issue = typeof Issue.Type

export const Rewrite = Schema.Struct({
  text: Schema.String,
  furigana: Schema.NullOr(Schema.String),
  translation: Schema.String,
  register: Register,
  note: Schema.String
})
export type Rewrite = typeof Rewrite.Type

export const FormalityReading = Schema.Struct({
  /** `0` (casual) to `1` (formal). */
  position: Schema.Number,
  confidence: Schema.Number
})
export type FormalityReading = typeof FormalityReading.Type

export const NaturalnessResult = Schema.Struct({
  verdict: Verdict,
  score: Schema.Int,
  summary: Schema.String,
  meaning: Schema.String,
  register: Schema.Literals(["casual", "neutral", "polite", "formal", "mixed"]),
  issues: Schema.Array(Issue),
  rewrites: Schema.Array(Rewrite),
  formality: Schema.NullOr(FormalityReading)
})
export type NaturalnessResult = typeof NaturalnessResult.Type

export const HowToSayRequest = Schema.Struct({
  text: Text(400),
  context: Schema.optional(Text(400)),
  register: Schema.optional(Schema.Literals(["any", "casual", "neutral", "polite", "formal"]))
})
export type HowToSayRequest = typeof HowToSayRequest.Type

export const Phrase = Schema.Struct({
  text: Schema.String,
  furigana: Schema.NullOr(Schema.String),
  literal: Schema.String,
  register: Register,
  nuance: Schema.String,
  whenToUse: Schema.String
})
export type Phrase = typeof Phrase.Type

export const KeyWord = Schema.Struct({
  word: Schema.String,
  reading: Schema.String,
  meaning: Schema.String,
  note: Schema.String,
  entryId: Schema.NullOr(EntryId)
})
export type KeyWord = typeof KeyWord.Type

export const Pitfall = Schema.Struct({
  text: Schema.String,
  why: Schema.String
})
export type Pitfall = typeof Pitfall.Type

export const HowToSayResult = Schema.Struct({
  intent: Schema.String,
  phrases: Schema.Array(Phrase),
  keyWords: Schema.Array(KeyWord),
  pitfalls: Schema.Array(Pitfall),
  culturalNote: Schema.NullOr(Schema.String)
})
export type HowToSayResult = typeof HowToSayResult.Type
