import type { LabelCode } from "@kotori/contracts"
import type { SenseToJudge, WordToJudge } from "../judge/word.ts"

/**
 * Builders for the golden sets' dictionary words, written as the passes see them: glosses, parts
 * of speech, label codes and the dictionary's usage patterns, copied from JMdict (created 2026-10-27) and
 * the curated English file (`data/english/enwiktionary-ja.jsonl`). Those excerpts are CC BY-SA 4.0:
 * see NOTICE.md beside this file.
 */

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
