import { integer, jsonb, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, table } from "./columns.ts"
import { entries } from "./entries.ts"
import { JudgmentSource } from "./senseNuance.ts"

/**
 * Whether a katakana loan means in everyday Japanese what its English word means (コーヒー,
 * coffee), has drifted, so a Japanese speaker carrying it over is misunderstood (スタイル is
 * first someone's figure), or wasn't borrowed from English at all (パン, from Portuguese).
 */
export const LoanMeaning = Schema.Literals(["same", "divergent", "not_english"])
export type LoanMeaning = typeof LoanMeaning.Type

/** Jev's verdict on a loan: its likeliest meaning, and how likely that is, over both option orders. */
export const LoanVerdict = Schema.Struct({
  value: LoanMeaning,
  /**
   * Jev's probability of `value`, averaged over the question asked in both option orders; not its
   * confidence, which measures how peaked an answer is.
   */
  probability: Schema.Number,
  source: JudgmentSource
})
export type LoanVerdict = typeof LoanVerdict.Type

/**
 * An English word's katakana loan, judged in the same Jev request as its senses: one row per
 * English entry the dictionary has katakana candidates for. Keeps the answers, so the verdict
 * can be re-derived, and Claude's warning, which survives a re-judge naming the same loan.
 */
export const loanWords = table("loan_words", {
  entryId: integer()
    .primaryKey()
    .references(() => entries.id, { onDelete: "cascade" }),
  /** The katakana loan, as JMDict spells it; null when Jev judged none of the candidates its loan. */
  word: text(),
  verdict: jsonb().$type<LoanVerdict>(),
  /** Jev's answers about each candidate, and the candidates asked about. */
  answers: jsonb().notNull(),
  /** Claude's one-sentence warning, in Japanese, once the loan confidently diverges. */
  trap: text(),
  model: text().notNull(),
  /** Which question set produced the answers (QUESTIONS_VERSION). */
  questionsVersion: integer().notNull(),
  createdAt: createdAt()
})
