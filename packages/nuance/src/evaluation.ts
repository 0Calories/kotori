import type { EntryRecord } from "@kotori/db"
import type { ChoiceResponse, EntryType, Question } from "@typesafe-ai/sdk"
import { REVERSED, reversedChoice } from "./questions.ts"
import { entryRequest, loanRequest, sensePrefix } from "./request.ts"
import { candidateOf } from "./state.ts"

/**
 * The requests `kotori eval` sends for the golden set, built with the production builders so
 * the eval measures what the enrichers ask. Every Choice is asked a second time with its
 * options in reverse order, under `${name}~reversed` in the same request: jev-1.13 leans
 * toward the option listed first (model-jaggedness docs), and every Kotori Choice lists its
 * uninformative default first.
 */

export interface EvalRequest {
  readonly state: EntryType
  readonly questions: Readonly<Record<string, Question>>
  /** What the request's keys carry before the stored answer names, e.g. a sense's `s0_`. */
  readonly prefix: string
}

/** The questions, plus every Choice not already asked both ways again with its options reversed. */
export const withReversedChoices = (questions: Readonly<Record<string, Question>>): Record<string, Question> => ({
  ...questions,
  ...Object.fromEntries(
    Object.entries(questions).flatMap(([name, question]) =>
      question.type === "choice" && !name.endsWith(REVERSED) && questions[`${name}${REVERSED}`] === undefined
        ? [[`${name}${REVERSED}`, reversedChoice(question)]]
        : []
    )
  )
})

/** How a Choice's answer held up with its options reversed. */
export interface OrderCheck {
  readonly name: string
  /** The two orders picked different options. */
  readonly flipped: boolean
  /** Each order picked the option it listed first: the bias the check looks for. */
  readonly towardFirst: boolean
}

export interface EvalReading {
  /** The answers named as stored (`formality`, `similar_0`, `loan_0`…), reversed twins included. */
  readonly answers: Readonly<Record<string, unknown>>
  readonly order: ReadonlyArray<OrderCheck>
}

/** Strips the request's key prefix from the answers and compares every Choice with its reversed twin. */
export const readGolden = (request: EvalRequest, answers: Readonly<Record<string, unknown>>): EvalReading => {
  const { prefix } = request
  const own = Object.fromEntries(
    Object.entries(answers).flatMap(([name, answer]) =>
      name.startsWith(prefix) ? [[name.slice(prefix.length), answer]] : []
    )
  )
  const order = Object.entries(request.questions).flatMap(([name, question]): Array<OrderCheck> => {
    const forward = answers[name] as ChoiceResponse | undefined
    const backward = answers[`${name}${REVERSED}`] as ChoiceResponse | undefined
    if (question.type !== "choice" || forward === undefined || backward === undefined) return []
    const options = Object.keys(question.criteria)
    return [
      {
        name: name.slice(prefix.length),
        flipped: forward.choice !== backward.choice,
        towardFirst: forward.choice === options[0] && backward.choice === options.at(-1)
      }
    ]
  })
  return { answers: own, order }
}

/** The questions whose keys start with `prefix`, as the request names them. */
const keysFrom = (questions: Readonly<Record<string, Question>>, prefix: string) =>
  Object.fromEntries(Object.entries(questions).filter(([name]) => name.startsWith(prefix)))

/**
 * A golden sense: the entry's request as the nuance job sends it, cut to that sense's
 * questions. Answers don't depend on the other questions in a request, so the eval pays for
 * one sense instead of six.
 */
export const goldenSenseRequest = (
  entry: EntryRecord,
  sense: number,
  tags: ReadonlyMap<string, string>
): EvalRequest => {
  const { state, questions } = entryRequest(entry, tags)
  const prefix = sensePrefix(sense)
  return { state, questions: withReversedChoices(keysFrom(questions, prefix)), prefix }
}

/** A golden pair: the entry's request with the similar word as the sense's only candidate, cut to its two questions. */
export const goldenPairRequest = (
  entry: EntryRecord,
  sense: number,
  similar: EntryRecord,
  similarSense: number,
  tags: ReadonlyMap<string, string>
): EvalRequest => {
  const candidates = Array.from({ length: sense + 1 }, (_, index) =>
    index === sense ? [candidateOf(similar, similarSense)] : []
  )
  const { state, questions } = entryRequest(entry, tags, candidates)
  const prefix = sensePrefix(sense)
  const pair = { ...keysFrom(questions, `${prefix}similar_0`), ...keysFrom(questions, `${prefix}difference_0`) }
  return { state, questions: withReversedChoices(pair), prefix }
}

/**
 * A golden loan: an English word's loan request as the nuance job sends it, with `candidates` as
 * its katakana candidates. Its Choices are already asked both ways.
 */
export const goldenLoanRequest = (
  entry: EntryRecord,
  candidates: ReadonlyArray<EntryRecord>,
  tags: ReadonlyMap<string, string>
): EvalRequest => {
  const { state, questions } = loanRequest(entry, candidates, tags)
  return { state, questions: withReversedChoices(questions), prefix: "" }
}

/**
 * A word's loan answers as if only `subset` of the katakana words `asked` had been candidates:
 * questions are answered independently, so asking about more candidates changes nothing else.
 */
export const answersForCandidates = (
  answers: Readonly<Record<string, unknown>>,
  asked: ReadonlyArray<string>,
  subset: ReadonlyArray<string>
): Record<string, unknown> => {
  const own = Object.fromEntries(Object.entries(answers).filter(([name]) => !/^loan(word)?_\d+/.test(name)))
  subset.forEach((word, k) => {
    const from = asked.indexOf(word)
    own[`loanword_${k}`] = answers[`loanword_${from}`]
    own[`loan_${k}`] = answers[`loan_${from}`]
    own[`loan_${k}${REVERSED}`] = answers[`loan_${from}${REVERSED}`]
  })
  return own
}
