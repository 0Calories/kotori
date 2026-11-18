import type { EntryType, NoulQuestion, NoulResponse } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { type Jev, JevDeadline, type JevError } from "../providers/Jev.ts"
import { meaningOf, type WordToJudge } from "./word.ts"

export const FORMAL_LABEL_VERSION = 1

export const FORMAL_LABEL_SURE = 0.7

export const FORMAL_LABEL_BATCH = 25

export interface FormalLabelSense {
  readonly word: WordToJudge
  readonly sense: number
}

// Keep prompt examples disjoint from GOLDEN_FORMAL_LABELS.
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

const partOfSpeech = (pos: ReadonlyArray<string>) => {
  const named = pos.map((code) => (/^v[0-9a-z]/.test(code) ? "verb" : POS[code])).find((name) => name !== undefined)
  return named ?? null
}

export const formalLabelQuestion = ({ word, sense }: FormalLabelSense): NoulQuestion => {
  const own = word.senses[sense]!
  const instructions: Record<string, EntryType> = {
    question: formal.instructions ?? null,
    word: word.headword,
    reading: word.reading,
    meaning: meaningOf(own)
  }
  const pos = partOfSpeech(own.pos)
  if (pos !== null) instructions["part_of_speech"] = pos
  if (own.usagePatterns.length > 0) instructions["dictionary_notes"] = own.usagePatterns.join("; ")
  return { ...formal, instructions }
}

export const formalLabelRequest = (senses: ReadonlyArray<FormalLabelSense>) => ({
  state: { language: "Japanese" } satisfies EntryType,
  questions: Object.fromEntries(senses.map((sense, index) => [`s${index}`, formalLabelQuestion(sense)]))
})

export const formalLabelProbabilities = (
  answers: Readonly<Record<string, unknown>>,
  count: number
): ReadonlyArray<number | null> =>
  Array.from({ length: count }, (_, index) => (answers[`s${index}`] as NoulResponse | undefined)?.noul ?? null)

export interface FormalLabelJudgment extends FormalLabelSense {
  readonly p: number
}

/** Caller must pass only senses with no existing register label; the prompt contrasts formal wording only against everyday speech. */
export const judgeFormalLabels = (
  jev: Jev["Service"],
  senses: ReadonlyArray<FormalLabelSense>
): Effect.Effect<ReadonlyArray<FormalLabelJudgment>, JevError> => {
  const batches: Array<ReadonlyArray<FormalLabelSense>> = []
  for (let start = 0; start < senses.length; start += FORMAL_LABEL_BATCH)
    batches.push(senses.slice(start, start + FORMAL_LABEL_BATCH))
  return Effect.forEach(batches, (batch) => {
    const request = formalLabelRequest(batch)
    return jev
      .ask(request.state, request.questions, { timeout: JevDeadline.bulk })
      .pipe(
        Effect.map(({ answers }) =>
          formalLabelProbabilities(answers, batch.length).flatMap((p, index) =>
            p === null ? [] : [{ ...batch[index]!, p }]
          )
        )
      )
  }).pipe(
    Effect.map((judged) => judged.flat()),
    Effect.withSpan("judgeFormalLabels", { attributes: { senses: senses.length, requests: batches.length } })
  )
}
