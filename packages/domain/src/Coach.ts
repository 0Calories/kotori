import * as Schema from "effect/Schema"
import { EntryId } from "./Dictionary.ts"

/** Speech register used across the coach features. */
export const Register = Schema.Literals(["casual", "neutral", "polite", "formal"])
export type Register = typeof Register.Type

const Text = (maxLength: number) =>
  Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(maxLength)))

// ---------------------------------------------------------------------------
// Naturalness check
// ---------------------------------------------------------------------------

export const NaturalnessRequest = Schema.Struct({
  /** A sentence written in the learner's target language. */
  text: Text(400),
  /** Optional situation: who you're talking to, where, why. */
  context: Schema.optional(Text(400)),
  /** Optional: what you were trying to say, in your native language. */
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
  /** 0 = very casual, 1 = very formal. */
  position: Schema.Number,
  confidence: Schema.Number
})
export type FormalityReading = typeof FormalityReading.Type

export const NaturalnessResult = Schema.Struct({
  verdict: Verdict,
  /** 0-100: how natural a native speaker would find the sentence. */
  score: Schema.Int,
  summary: Schema.String,
  /** What the sentence actually conveys, in the learner's native language. */
  meaning: Schema.String,
  register: Schema.Literals(["casual", "neutral", "polite", "formal", "mixed"]),
  issues: Schema.Array(Issue),
  rewrites: Schema.Array(Rewrite),
  /** Jev's independent read of how formal the sentence sounds. */
  formality: Schema.NullOr(FormalityReading)
})
export type NaturalnessResult = typeof NaturalnessResult.Type

// ---------------------------------------------------------------------------
// How do I say…
// ---------------------------------------------------------------------------

export const HowToSayRequest = Schema.Struct({
  /** What you want to say, in your native language. */
  text: Text(400),
  context: Schema.optional(Text(400)),
  register: Schema.optional(Schema.Literals(["any", "casual", "neutral", "polite", "formal"]))
})
export type HowToSayRequest = typeof HowToSayRequest.Type

export const Phrase = Schema.Struct({
  text: Schema.String,
  furigana: Schema.NullOr(Schema.String),
  /** A literal back-translation, so learners can see how it's built. */
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
  /** Kotori's understanding of what you mean, so you can catch misreadings. */
  intent: Schema.String,
  phrases: Schema.Array(Phrase),
  keyWords: Schema.Array(KeyWord),
  pitfalls: Schema.Array(Pitfall),
  culturalNote: Schema.NullOr(Schema.String)
})
export type HowToSayResult = typeof HowToSayResult.Type
