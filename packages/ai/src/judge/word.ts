import type { LabelCode, LoanLinkMeaning } from "@kotori/contracts"

/**
 * A dictionary word as the offline passes (`kotori judge`) show it to a model: what the entry page
 * already tells the learner, so a judgment fills only what it leaves unsaid. The backend builds it
 * from the database; the golden sets write it out.
 */

export interface SenseToJudge {
  /** In the other language from the headword, as the dictionary gives them. */
  readonly glosses: ReadonlyArray<string>
  /** Part-of-speech codes (JMDict's for both dictionaries). */
  readonly pos: ReadonlyArray<string>
  /** Usage label codes the sense carries, from any source (`LABEL_SEVERITY` in `@kotori/db`). */
  readonly labels: ReadonlyArray<LabelCode>
  /** The dictionary's usage patterns (JMDict's `s_inf`, the English dictionary's notes). */
  readonly usagePatterns: ReadonlyArray<string>
}

/** A katakana loan and its English word, from the end the word is not. */
export interface LoanToJudge {
  /** The other word: the katakana loan on an English word, the English word on a katakana one. */
  readonly word: string
  /** Whether the loan is a true loanword or wasei-eigo; null until a source says. */
  readonly meaning: LoanLinkMeaning | null
  /** The other word's dictionary glosses, so the drift can be named. */
  readonly glosses: ReadonlyArray<string>
}

export interface WordToJudge {
  readonly headword: string
  /** Kana for a Japanese word; IPA (or nothing) for an English one. */
  readonly reading: string
  readonly senses: ReadonlyArray<SenseToJudge>
  readonly loan?: LoanToJudge | null | undefined
}

/** A sense's glosses as one line, the first few only: the leading glosses carry the meaning. */
export const meaningOf = (sense: SenseToJudge, glosses = 6) => sense.glosses.slice(0, glosses).join("; ")
