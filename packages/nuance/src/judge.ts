import type { Nuance } from "@kotori/domain"
import type { EntryRecord } from "@kotori/jmdict"
import type { Question } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { interpretCandidates, interpretSense, type SenseAnswers, type SimilarJudgment } from "./interpret.ts"
import { Jev } from "./Jev.ts"
import { candidateQuestions, senseQuestions } from "./questions.ts"
import { type CandidateState, senseState } from "./state.ts"

/** Senses beyond these rarely matter to learners and are left unclassified. */
const MAX_SENSES = 6

/** Jev's nuance for one sense, with the raw answers so labels can be re-derived without paying for inference again. */
export interface SenseJudgment {
  readonly sense: number
  readonly nuance: Nuance
  readonly answers: unknown
  readonly model: string
}

export interface EntryJudgment {
  readonly senses: ReadonlyArray<SenseJudgment>
  /** Candidates Jev judged near-synonyms of a sense, most similar first within each. */
  readonly similar: ReadonlyArray<SimilarJudgment & { readonly sense: number }>
  readonly inputTokens: number
}

/**
 * Asks Jev how an entry's main senses come across and, for each sense with
 * candidates (`candidates[index]`), which of them are near-synonyms and how they
 * differ. Returns the judgments; storing them is the caller's.
 */
export const judgeEntry = Effect.fn("Nuance.judgeEntry")(function* (
  entry: EntryRecord,
  tags: ReadonlyMap<string, string>,
  candidates: ReadonlyArray<ReadonlyArray<CandidateState>>
) {
  const jev = yield* Jev
  const judged = yield* Effect.forEach(
    entry.senses.slice(0, MAX_SENSES),
    (sense, index) =>
      Effect.gen(function* () {
        const forSense = candidates[index] ?? []
        const questions: Record<string, Question> = { ...senseQuestions }
        forSense.forEach((_, i) => Object.assign(questions, candidateQuestions(i)))
        const result = yield* jev.ask(senseState(entry, index, tags, forSense), questions)
        return { index, misc: sense.misc, candidates: forSense, result }
      }),
    { concurrency: 3 }
  )

  return {
    senses: judged.map(({ index, misc, result }) => ({
      sense: index,
      nuance: interpretSense(result.answers as unknown as SenseAnswers, misc),
      answers: result.answers,
      model: result.model
    })),
    similar: judged.flatMap(({ index, candidates, result }) =>
      interpretCandidates(
        result.answers,
        candidates.map((c) => c.entryId)
      ).map((j) => ({ sense: index, ...j }))
    ),
    inputTokens: judged.reduce((sum, { result }) => sum + result.usage.input_tokens, 0)
  } satisfies EntryJudgment
})
