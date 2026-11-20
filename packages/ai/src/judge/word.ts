import type { LabelCode, LoanLinkMeaning } from "@kotori/contracts"

export interface SenseToJudge {
  readonly glosses: ReadonlyArray<string>
  readonly pos: ReadonlyArray<string>
  readonly labels: ReadonlyArray<LabelCode>
  readonly usagePatterns: ReadonlyArray<string>
}

export interface LoanToJudge {
  readonly word: string
  readonly meaning: LoanLinkMeaning | null
  readonly glosses: ReadonlyArray<string>
}

export interface WordToJudge {
  readonly headword: string
  readonly reading: string
  readonly senses: ReadonlyArray<SenseToJudge>
  readonly loan?: LoanToJudge | null | undefined
}

export const meaningOf = (sense: SenseToJudge, glosses = 6) => sense.glosses.slice(0, glosses).join("; ")
