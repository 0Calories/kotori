import type { LoanLinkMeaning } from "@kotori/contracts"
import type { ChoiceQuestion, EntryType, NoulQuestion, NoulResponse, Question } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { averagedChoice, REVERSED, reversedChoice } from "../providers/choices.ts"
import { type Jev, JevDeadline, type JevError } from "../providers/Jev.ts"

export const LOANS_VERSION = 1

export const MAX_LOANS = 3

const MAX_LOAN_SENSES = 6

export const LOAN_IS = 0.7

export const LOAN_SURE = 0.7

export interface LoanCandidate {
  readonly katakana: string
  readonly meanings: ReadonlyArray<string>
  readonly wasei: boolean
  readonly by: "gloss" | "source"
}

export const loanSenseLine = (glosses: ReadonlyArray<string>, notes: ReadonlyArray<string>) => {
  const leading = glosses.slice(0, 3).join("; ")
  return notes.length > 0 ? `${leading} [${notes.join("; ")}]` : leading
}

// Phrasing "false" as "only a translation" makes Jev score true loans like テーブル near 0, since true loans also translate the English word.
const isLoan: NoulQuestion = {
  type: "noul",
  instructions:
    "Is `katakana_word` the everyday katakana loanword of the English word `english_word`: the word Japanese borrowed from it?",
  criteria: {
    true: "Yes: Japanese speakers know `katakana_word` as the word borrowed from `english_word`, whatever it has come to mean in Japanese, e.g. ピアノ for 'piano'",
    false:
      "No: `katakana_word` is borrowed from a different English word, even where it translates `english_word`, e.g. トラック (from 'truck') for 'lorry'"
  }
}

const LOAN_EVIDENCE =
  "`katakana_meanings` are a dictionary's translations of `katakana_word`, with its usage notes in brackets. They often list the English source word itself even where everyday Japanese uses the word differently: judge how Japanese speakers commonly use it today, leaving out rare, historical and specialist meanings."

// Without explicitly ignoring small usage differences in "same", Jev marks nearly every true loan as divergent.
const meaning: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Does the katakana loanword `katakana_word` share the same meaning as the original word it's taken from in English, `english_word`, or has it come to mean something different in everyday Japanese?",
  criteria: {
    same: "A Japanese speaker can use `english_word` wherever they would use `katakana_word` in everyday Japanese, and English speakers understand them, e.g. ピアノ for 'piano', バス for 'bus'. Small differences in how often or where each is used don't count",
    divergent:
      "A common use of `katakana_word` means something `english_word` doesn't, or carries a clearly different feeling, even where they share a meaning, so a Japanese speaker who uses `english_word` that way misleads English speakers, e.g. トレーナー (a sweatshirt, as well as a trainer), サービス ('free of charge', as well as service), コンセント (a power socket, not 'consent')",
    not_english:
      "`katakana_word` was borrowed from another language, not from English, e.g. アルバイト (from German Arbeit), パン (from Portuguese pão)"
  }
}

const MEANINGS = ["same", "divergent", "not_english"] as const
type Meaning = (typeof MEANINGS)[number]

export const loanRequest = (english: string, candidates: ReadonlyArray<LoanCandidate>) => {
  const questions: Record<string, Question> = {}
  candidates.slice(0, MAX_LOANS).forEach((candidate, k) => {
    // Jev scored true loans below 0.2 when english_word was only in shared state, so each question repeats it in instructions.
    const scope: Record<string, EntryType> = {
      english_word: english,
      katakana_word: candidate.katakana,
      katakana_meanings: candidate.meanings.slice(0, MAX_LOAN_SENSES)
    }
    if (candidate.wasei) {
      scope["katakana_note"] = "The dictionary marks it wasei-eigo: English-looking, but coined in Japan"
    }
    const asked: ChoiceQuestion = {
      ...meaning,
      instructions: { question: meaning.instructions ?? null, ...scope, evidence: LOAN_EVIDENCE }
    }
    questions[`loanword_${k}`] = { ...isLoan, instructions: { question: isLoan.instructions ?? null, ...scope } }
    questions[`loan_${k}`] = asked
    questions[`loan_${k}${REVERSED}`] = reversedChoice(asked)
  })
  return { state: { english_word: english } satisfies EntryType, questions }
}

export interface LoanReading {
  readonly katakana: string | null
  readonly meaning: LoanLinkMeaning | null
  readonly p: number | null
  readonly meanings: Readonly<Record<Meaning, number>> | null
}

export const interpretLoan = (
  answers: Readonly<Record<string, unknown>>,
  candidates: ReadonlyArray<LoanCandidate>,
  thresholds: { readonly loanIs?: number; readonly sure?: number } = {}
): LoanReading => {
  const loanIs = thresholds.loanIs ?? LOAN_IS
  const sure = thresholds.sure ?? LOAN_SURE
  const likeliest = candidates
    .slice(0, MAX_LOANS)
    .map((candidate, k) => ({
      candidate,
      k,
      p: candidate.by === "source" ? 1 : ((answers[`loanword_${k}`] as NoulResponse | undefined)?.noul ?? 0)
    }))
    .reduce<{ candidate: LoanCandidate; k: number; p: number } | undefined>(
      (best, next) => (best === undefined || next.p > best.p ? next : best),
      undefined
    )
  if (likeliest === undefined || likeliest.p < loanIs) {
    return { katakana: null, meaning: null, p: null, meanings: null }
  }
  const { probabilities, orders } = averagedChoice(answers, `loan_${likeliest.k}`, MEANINGS)
  if (orders < 2) return { katakana: likeliest.candidate.katakana, meaning: null, p: null, meanings: null }
  const best = MEANINGS.reduce((top, option) => (probabilities[option] > probabilities[top] ? option : top))
  const verdict: LoanLinkMeaning | null =
    probabilities[best] < sure ? null : best === "same" ? "true_loanword" : best === "divergent" ? "wasei_eigo" : null
  return { katakana: likeliest.candidate.katakana, meaning: verdict, p: probabilities[best], meanings: probabilities }
}

export interface LoanToAsk {
  readonly english: string
  readonly candidates: ReadonlyArray<LoanCandidate>
}

export const judgeLoans = (
  jev: Jev["Service"],
  words: ReadonlyArray<LoanToAsk>,
  concurrency = 4
): Effect.Effect<ReadonlyArray<LoanReading & { readonly answers: Readonly<Record<string, unknown>> }>, JevError> =>
  Effect.forEach(
    words,
    ({ english, candidates }) => {
      const request = loanRequest(english, candidates)
      return jev
        .ask(request.state, request.questions, { timeout: JevDeadline.bulk })
        .pipe(Effect.map(({ answers }) => ({ ...interpretLoan(answers, candidates), answers })))
    },
    { concurrency }
  ).pipe(Effect.withSpan("judgeLoans", { attributes: { words: words.length } }))
