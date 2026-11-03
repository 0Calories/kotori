import {
  AgeGroup,
  Connotation,
  Currency,
  difference,
  Formality,
  Gender,
  JudgmentSource,
  Keigo,
  LoanMeaning,
  LoanVerdict,
  loanWords,
  Medium,
  Nuance,
  Profanity,
  RegisterShape,
  Variety
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export {
  AgeGroup,
  Connotation,
  Currency,
  Formality,
  Gender,
  JudgmentSource,
  Keigo,
  LoanMeaning,
  LoanVerdict,
  Medium,
  Nuance,
  Profanity,
  RegisterShape,
  Variety
}

type TagTable<A> = ReadonlyArray<readonly [string, A]>

/**
 * The dictionary's usage tags that decide a judgment outright, the first listed winning: JMDict's
 * codes, which the English dictionary maps Wiktionary's and EJDict's labels and its regions to.
 * The nuance interpretation reads them over Jev's answers, and the entry page leaves a tag out of
 * a sense's chips once the judgments it decided are shown, so 口語 isn't said again beside
 * 「カジュアル · 話し言葉」.
 */
export const TAG_JUDGMENTS: {
  readonly formality: TagTable<Formality>
  readonly medium: TagTable<Medium>
  readonly keigo: TagTable<Keigo>
  readonly gender: TagTable<Gender>
  readonly age: TagTable<AgeGroup>
  readonly currency: TagTable<Currency>
  readonly connotation: TagTable<Connotation>
  /** Tags whose words sit at one obvious register, so a slider is the wrong model. */
  readonly registerShape: TagTable<RegisterShape>
  /** The English dictionary's regions; other varieties (Australian, Indian…) are left to Jev. */
  readonly variety: TagTable<Variety>
} = {
  formality: [
    ["vulg", "vulgar"],
    ["X", "vulgar"],
    ["hon", "formal"],
    ["hum", "formal"],
    ["form", "formal"],
    ["pol", "polite"],
    ["sl", "casual"],
    ["net-sl", "casual"],
    ["m-sl", "casual"],
    ["col", "casual"],
    ["fam", "casual"],
    ["chn", "casual"]
  ],
  medium: [
    ["col", "spoken"],
    ["sl", "spoken"],
    ["net-sl", "spoken"],
    ["fam", "spoken"],
    ["form", "written"],
    ["poet", "written"]
  ],
  keigo: [
    ["hon", "sonkeigo"],
    ["hum", "kenjougo"],
    ["pol", "teineigo"]
  ],
  gender: [
    ["male", "masculine"],
    ["fem", "feminine"]
  ],
  age: [
    ["chn", "children"],
    ["net-sl", "youth"],
    ["m-sl", "youth"]
  ],
  currency: [
    ["arch", "archaic"],
    ["obs", "archaic"],
    ["dated", "dated"]
  ],
  connotation: [
    ["derog", "negative"],
    ["vulg", "negative"]
  ],
  registerShape: [
    ["vulg", "fixed"],
    ["X", "fixed"],
    ["derog", "fixed"]
  ],
  variety: [
    ["en-US", "american"],
    ["en-GB", "british"]
  ]
}

/** Tags that make a sense slang outright, which the slang caution then says. */
export const SLANG_TAGS: ReadonlyArray<string> = ["sl", "net-sl", "m-sl"]

/** The katakana loan of an English word, which Japanese speakers already think they know. */
export const Loanword = Schema.Struct({
  /** The katakana word, as JMDict spells it. */
  word: Schema.String,
  verdict: LoanVerdict,
  ...Struct.pick(createSelectSchema(loanWords).fields, ["trap"])
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
export const Difference = createSelectSchema(difference)
export type Difference = typeof Difference.Type
