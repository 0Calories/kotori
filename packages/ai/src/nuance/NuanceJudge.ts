import type { EntryRecord, Nuance } from "@kotori/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Jev, type JevError } from "../providers/Jev.ts"
import { answersOfLoans } from "./english.ts"
import {
  type AskedLoan,
  interpretCandidates,
  interpretLoan,
  interpretSense,
  type LoanReading,
  type SenseAnswers,
  senseTags,
  type SimilarJudgment
} from "./interpret.ts"
import { answersOfSense, entryRequest, loanRequest, questionsVersionOf } from "./request.ts"
import { type CandidateState, judgedSenses } from "./state.ts"

/** An English word's katakana loan candidate, and whether JMDict glosses it with the word or names it as the source. */
export interface LoanCandidate {
  readonly entry: EntryRecord
  readonly by: AskedLoan["by"]
}

/** Everything Jev is asked about one entry, gathered by the caller from wherever the dictionary lives. */
export interface NuanceQuestion {
  readonly entry: EntryRecord
  /** Tag codes with their labels, for the senses' usage notes. */
  readonly tags: ReadonlyMap<string, string>
  /** Similar-word candidates per judged sense, by index; senses without any may be left out. */
  readonly candidates: ReadonlyArray<ReadonlyArray<CandidateState>>
  /** An English word's katakana loan candidates, most frequent first; empty for Japanese words. */
  readonly loans: ReadonlyArray<LoanCandidate>
}

/** One judged sense: the interpretation, and the raw answers it came from so it can be re-derived. */
export interface SenseJudgment {
  readonly sense: number
  readonly nuance: Nuance
  readonly answers: Readonly<Record<string, unknown>>
}

/** An English word's loan as judged, with the answers and candidates kept so the verdict can be re-derived. */
export interface LoanJudgment extends LoanReading {
  readonly answers: Readonly<Record<string, unknown>>
  readonly model: string
}

export interface NuanceJudgment {
  readonly model: string
  /** Which question set produced the answers; older judgments are refreshed on view. */
  readonly questionsVersion: number
  readonly senses: ReadonlyArray<SenseJudgment>
  readonly similar: ReadonlyArray<SimilarJudgment & { readonly sense: number }>
  /** Null when the entry had no loan candidates to ask about. */
  readonly loan: LoanJudgment | null
  readonly inputTokens: number
}

/** The katakana words asked about, kept with the loan answers so the verdict can be re-derived. */
const StoredLoans = Schema.Struct({
  candidates: Schema.Array(Schema.Struct({ word: Schema.String, by: Schema.Literals(["gloss", "source"]) }))
})

/** Re-derives a loan verdict from answers a `LoanJudgment` stored, without inference. */
export const reinterpretLoan = (answers: Readonly<Record<string, unknown>>): LoanReading =>
  interpretLoan(
    answers,
    Option.match(Schema.decodeUnknownOption(StoredLoans)(answers), {
      onNone: () => [],
      onSome: (stored) => stored.candidates
    })
  )

/**
 * Jev's nuance judgments on a dictionary entry: how each judged sense sounds, which candidates
 * are near-synonyms and how they differ, and whether an English word's katakana loan drifted.
 * Stateless: the caller gathers the entry and its candidates, and keeps what comes back.
 */
export class NuanceJudge extends Context.Service<
  NuanceJudge,
  {
    readonly configured: boolean
    /** The pinned Jev model; judgments record it. */
    readonly model: string
    judge(question: NuanceQuestion): Effect.Effect<NuanceJudgment, JevError>
  }
>()("@kotori/ai/NuanceJudge") {
  static readonly layer = Layer.effect(
    NuanceJudge,
    Effect.gen(function* () {
      const jev = yield* Jev

      const judge = Effect.fn("NuanceJudge.judge")(function* ({ entry, tags, candidates, loans }: NuanceQuestion) {
        const senses = judgedSenses(entry)
        const questionsVersion = questionsVersionOf(entry.language)
        if (senses.length === 0) {
          return { model: jev.model, questionsVersion, senses: [], similar: [], loan: null, inputTokens: 0 }
        }

        // One request for the senses: every sense's questions, each carrying its sense's scope,
        // and the candidate comparisons. Questions run in parallel, so a learner waits one round
        // trip instead of one per sense. An English word's loan candidates are asked at the same
        // time in a request of their own, whose state leaves out the senses (`loanRequest`).
        const request = entryRequest(entry, tags, candidates)
        const loanAsked =
          loans.length === 0
            ? null
            : loanRequest(
                entry,
                loans.map((loan) => loan.entry),
                tags
              )
        const [result, loanResult] = yield* Effect.all(
          [
            jev.ask(request.state, request.questions),
            loanAsked === null ? Effect.succeed(null) : jev.ask(loanAsked.state, loanAsked.questions)
          ],
          { concurrency: 2 }
        )

        const judged = senses.map((sense, index) => ({ index, sense, answers: answersOfSense(result.answers, index) }))
        const asked: ReadonlyArray<AskedLoan> = loans.map((loan) => ({ word: loan.entry.headword, by: loan.by }))
        const loanAnswers = loanResult === null ? {} : answersOfLoans(loanResult.answers)
        return {
          model: result.model,
          questionsVersion,
          senses: judged.map(({ index, sense, answers }) => ({
            sense: index,
            nuance: interpretSense(answers as unknown as SenseAnswers, senseTags(sense), sense.fields),
            answers
          })),
          similar: judged.flatMap(({ index, answers }) =>
            interpretCandidates(
              answers,
              (candidates[index] ?? []).map((candidate) => candidate.entryId)
            ).map((judgment) => ({ sense: index, ...judgment }))
          ),
          loan:
            loanResult === null
              ? null
              : {
                  ...interpretLoan(loanAnswers, asked),
                  answers: { ...loanAnswers, candidates: asked },
                  model: loanResult.model
                },
          inputTokens: result.usage.input_tokens + (loanResult?.usage.input_tokens ?? 0)
        }
      })

      return NuanceJudge.of({ configured: jev.configured, model: jev.model, judge })
    })
  )
}
