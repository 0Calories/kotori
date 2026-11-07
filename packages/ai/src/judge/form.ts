import type { EntryType, NoulQuestion, NoulResponse } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import type { Jev, JevError } from "../providers/Jev.ts"
import { meaningOf, type WordToJudge } from "./word.ts"

/**
 * The `ja-form` pass: Jev's judgment of whether a Japanese word, in one sense, is formal or
 * literary wording (鑑みる, 及び, 当該) that JMDict leaves untagged. A yes becomes Kotori's `form`
 * label on that sense. Only senses the dictionary says nothing about the register of are asked
 * (the caller picks them): silence on a keigo or slang word is never the question.
 */

/** Bumped when the question is reworded or what it sees changes; written in the artifact's header. */
export const FORM_VERSION = 1

/**
 * How sure Jev must be to label a sense `form`. A wrong label tells a learner a plain word is
 * stiff, which is worse than the dictionary's silence, so it sits at the docs' starting point for
 * a yes rather than a coin flip (`kotori eval ja-form` reports the other cut-offs).
 */
export const FORM_SURE = 0.7

/** Senses per Jev request: one question each, well inside a request's token limit. */
export const FORM_BATCH = 25

/** One sense of one word to ask about. */
export interface FormSense {
  readonly word: WordToJudge
  /** The sense's position in `word.senses`. */
  readonly sense: number
}

// Examples are kept out of the golden set, so the eval measures what the criteria don't spell out.
// Business, law and other formal subjects are not formal wording: 確認 and 会議 are everyday words.
const formal: NoulQuestion = {
  type: "noul",
  instructions:
    "Is the Japanese word `word` (read `reading`), in the meaning `meaning`, formal or literary wording: at home in documents, news, official notices, letters and speeches, but stiff or bookish in everyday conversation, where natives would say something plainer?",
  criteria: {
    true: "Yes: in ordinary conversation natives would normally use a plainer word for this meaning, e.g. 直ちに (すぐ), 当社 (うちの会社), 依然 (まだ), 拙速 (急ぎすぎ)",
    false:
      "No: it is everyday wording that fits ordinary conversation, even if it is common in writing too or names something from business, law or another formal subject, e.g. 歩く, まだ, 書類, 説明する, 契約"
  }
}

const POS: Readonly<Record<string, string>> = {
  n: "noun",
  adv: "adverb",
  conj: "conjunction",
  exp: "expression",
  int: "interjection",
  pn: "pronoun",
  prt: "particle",
  "adj-i": "adjective",
  "adj-na": "na-adjective",
  "adj-no": "noun or adjective taking の",
  "adj-t": "adjective taking と",
  "adj-pn": "pre-noun adjective",
  "adv-to": "adverb taking と"
}

/** A sense's part of speech in words: the first code a learner would recognise, verbs as "verb". */
const partOfSpeech = (pos: ReadonlyArray<string>) => {
  const named = pos.map((code) => (/^v[0-9a-z]/.test(code) ? "verb" : POS[code])).find((name) => name !== undefined)
  return named ?? null
}

/** The question about one sense, carrying the word and its meaning beside the wording. */
export const formQuestion = ({ word, sense }: FormSense): NoulQuestion => {
  const own = word.senses[sense]!
  const instructions: Record<string, EntryType> = {
    question: formal.instructions ?? null,
    word: word.headword,
    reading: word.reading,
    meaning: meaningOf(own)
  }
  const pos = partOfSpeech(own.pos)
  if (pos !== null) instructions["part_of_speech"] = pos
  if (own.notes.length > 0) instructions["dictionary_notes"] = own.notes.join("; ")
  return { ...formal, instructions }
}

/** A request for up to `FORM_BATCH` senses, keyed `s{index}` in order. */
export const formRequest = (senses: ReadonlyArray<FormSense>) => ({
  state: { language: "Japanese" } satisfies EntryType,
  questions: Object.fromEntries(senses.map((sense, index) => [`s${index}`, formQuestion(sense)]))
})

/** Each sense's probability of being formal wording, in order; null where Jev gave no answer. */
export const formProbabilities = (
  answers: Readonly<Record<string, unknown>>,
  count: number
): ReadonlyArray<number | null> =>
  Array.from({ length: count }, (_, index) => (answers[`s${index}`] as NoulResponse | undefined)?.noul ?? null)

export interface FormJudgment extends FormSense {
  /** Jev's probability that the sense is formal wording. */
  readonly p: number
}

/**
 * Jev's judgment of every sense, in requests of `FORM_BATCH`. A sense Jev left unanswered is left
 * out, so a later run asks again.
 */
export const judgeForm = (
  jev: Jev["Service"],
  senses: ReadonlyArray<FormSense>
): Effect.Effect<ReadonlyArray<FormJudgment>, JevError> => {
  const batches: Array<ReadonlyArray<FormSense>> = []
  for (let start = 0; start < senses.length; start += FORM_BATCH) batches.push(senses.slice(start, start + FORM_BATCH))
  return Effect.forEach(batches, (batch) => {
    const request = formRequest(batch)
    return jev
      .ask(request.state, request.questions)
      .pipe(
        Effect.map(({ answers }) =>
          formProbabilities(answers, batch.length).flatMap((p, index) => (p === null ? [] : [{ ...batch[index]!, p }]))
        )
      )
  }).pipe(
    Effect.map((judged) => judged.flat()),
    Effect.withSpan("judgeForm", { attributes: { senses: senses.length, requests: batches.length } })
  )
}
