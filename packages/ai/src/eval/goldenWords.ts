import type { LabelCode } from "@kotori/contracts"
import type { SenseToJudge, WordToJudge } from "../judge/word.ts"

export const s = (
  glosses: ReadonlyArray<string>,
  pos: ReadonlyArray<string>,
  labels: ReadonlyArray<LabelCode> = [],
  usagePatterns: ReadonlyArray<string> = []
): SenseToJudge => ({ glosses, pos, labels, usagePatterns })

export const word = (
  headword: string,
  reading: string,
  senses: ReadonlyArray<SenseToJudge>,
  loan?: WordToJudge["loan"]
): WordToJudge => (loan === undefined ? { headword, reading, senses } : { headword, reading, senses, loan })
