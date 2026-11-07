import type { ChoiceQuestion, EntryType, NoulQuestion, NoulResponse, Question } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { averagedChoice, REVERSED, reversedChoice } from "../providers/choices.ts"
import type { Jev, JevError } from "../providers/Jev.ts"

/**
 * The loan pass: Jev's verdict on whether an English word's katakana loan means what the English
 * word does (アドバイス for advice) or has drifted (マンション for mansion). A drifted loan is the
 * English entry's false friend; one that kept its meaning gives it a "same as 「アドバイス」" chip.
 * Code finds the candidates (common katakana words with the English word as a gloss, or as their
 * JMDict source); Jev picks among them rather than recalling a loan, which it isn't trained to do.
 *
 * The questions are the old nuance job's, tuned on the golden loans before Phase 7 removed them:
 * see the notes on each for what each wording fixed.
 */

/** Bumped when a question is reworded or what it sees changes; written in the artifact's header. */
export const LOANS_VERSION = 1

/** Katakana candidates asked about per English word, most frequent first. */
export const MAX_LOANS = 3

/** Senses of a katakana candidate shown to Jev; later ones rarely matter. */
const MAX_LOAN_SENSES = 6

/**
 * How likely a candidate must be the English word's loan for its verdict to count: the docs'
 * starting point for a yes. A pair JMDict names (`by: "source"`) is certain.
 */
export const LOAN_IS = 0.7

/**
 * How likely a meaning must be to be written. A false warning or a wrong "same" chip costs trust
 * in the very feature meant to build it, so an unsure verdict is left out and the link says
 * nothing about meaning.
 */
export const LOAN_SURE = 0.7

/** A katakana word that may be an English word's loan, as the dictionary gives it. */
export interface LoanCandidate {
  readonly katakana: string
  /** Each sense's leading glosses, with its usage notes in brackets ("tension [physics]"). */
  readonly meanings: ReadonlyArray<string>
  /** JMDict marks it wasei-eigo: English-looking, coined in Japan. */
  readonly wasei: boolean
  /** `gloss`: it has the English word as a gloss; `source`: JMDict names the English word as its source. */
  readonly by: "gloss" | "source"
}

/** A katakana sense as a candidate shows it: three glosses, and the descriptions of its notes. */
export const loanSenseLine = (glosses: ReadonlyArray<string>, notes: ReadonlyArray<string>) => {
  const leading = glosses.slice(0, 3).join("; ")
  return notes.length > 0 ? `${leading} [${notes.join("; ")}]` : leading
}

// A gloss match can be a false candidate (トラック has the gloss "lorry", but is the loan of
// "truck"), so a Noul asks whether the pair is a loan at all. On an English word the katakana word
// is often one of its translations (テーブル for "table"), so "only another translation" can't be
// the "no": asked that way, Jev said no to テーブル at 0.04. Both questions name the English word
// in their own instructions: with it only in the state, Jev put テーブル, ドア and スタイル below 0.2.
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

// Jev took a dictionary translation that repeats the source word (テンション: "tension",
// シール: "seal") for the everyday meaning, so the evidence comes with how to read it.
const LOAN_EVIDENCE =
  "`katakana_meanings` are a dictionary's translations of `katakana_word`, with its usage notes in brackets. They often list the English source word itself even where everyday Japanese uses the word differently: judge how Japanese speakers commonly use it today, leaving out rare, historical and specialist meanings."

// The trap is a meaning the English word doesn't have: スタイル is "style", but first someone's
// figure. Asked only about the shared meaning, Jev called スタイル, ジュース and ナイーブ matches, so
// the options weigh every common use. Asked whether every use matched "with the same feeling", Jev
// found some difference in nearly every loan, so small differences don't count. "Not English"
// takes about 1% from true loans. Read averaged over both option orders.
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

/**
 * The questions about an English word's candidates: `loanword_{k}` (is it the word's loan?) and
 * `loan_{k}` (same, divergent or not English), asked again reversed as `loan_{k}~reversed`.
 */
export const loanRequest = (english: string, candidates: ReadonlyArray<LoanCandidate>) => {
  const questions: Record<string, Question> = {}
  candidates.slice(0, MAX_LOANS).forEach((candidate, k) => {
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

/** An English word's loan as judged. */
export interface LoanReading {
  /** The likeliest candidate to be its loan; null when none is likely enough (`LOAN_IS`). */
  readonly katakana: string | null
  /** Its meaning when sure enough (`LOAN_SURE`); null when unsure or borrowed from another language. */
  readonly meaning: "same" | "divergent" | null
  /** The probability of `meaning`, or of the likeliest meaning when none is sure. */
  readonly p: number | null
  /** Each meaning's probability for the chosen candidate, both orders averaged. */
  readonly meanings: Readonly<Record<Meaning, number>> | null
}

/**
 * The likeliest candidate to be the English word's loan (one JMDict names certainly, the others as
 * likely as Jev judges), and Jev's verdict on its meaning, read from the Choice in both orders.
 */
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
  const verdict = best !== "not_english" && probabilities[best] >= sure ? best : null
  return { katakana: likeliest.candidate.katakana, meaning: verdict, p: probabilities[best], meanings: probabilities }
}

/** An English word and its candidates, to judge. */
export interface LoanToAsk {
  readonly english: string
  readonly candidates: ReadonlyArray<LoanCandidate>
}

/** Every word's reading, one Jev request each (three candidates' questions), in order. */
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
        .ask(request.state, request.questions)
        .pipe(Effect.map(({ answers }) => ({ ...interpretLoan(answers, candidates), answers })))
    },
    { concurrency }
  ).pipe(Effect.withSpan("judgeLoans", { attributes: { words: words.length } }))
