import type { EntryRecord } from "@kotori/db"
import type { Language } from "@kotori/domain"
import type { ChoiceQuestion, EntryType, NoulQuestion, Question } from "@typesafe-ai/sdk"
import { ENGLISH_QUESTIONS_VERSION, englishSenseQuestions, loanQuestions, MAX_LOANS } from "./english.ts"
import { DIFFERENCES, QUESTIONS_VERSION, senseQuestions } from "./questions.ts"
import { type CandidateState, candidateScope, entryState, judgedSenses, type SenseScope, senseScope } from "./state.ts"

/** The question set a word's stored judgments are compared with, by the word's language. */
export const questionsVersionOf = (language: Language) =>
  language === "ja" ? QUESTIONS_VERSION : ENGLISH_QUESTIONS_VERSION

/**
 * Whether an entry's stored judgments are behind: some predate its language's question set, or a
 * re-import has ranked a sense nobody judged among the judged ones (judged rows follow their
 * senses, so one may lead without any). Viewing such an entry queues it to be judged again.
 */
export const nuanceOutdated = (
  entry: EntryRecord,
  rows: ReadonlyArray<{ readonly sense: number; readonly questionsVersion: number }>
) => {
  const judged = new Set(rows.map((row) => row.sense))
  return (
    rows.some((row) => row.questionsVersion < questionsVersionOf(entry.language)) ||
    (rows.length > 0 && judgedSenses(entry).some((_, index) => !judged.has(index)))
  )
}

/** Names the sense a question is about: every question sees all of `senses`. */
const FOCUS: Record<Language, string> = {
  ja: "The word has the senses listed in `senses`. Judge only the sense whose meaning is `meaning`; `part_of_speech` and `dictionary_notes` are the dictionary's information on that sense.",
  en: "The English word has the senses listed in `senses`, translated into Japanese. Judge only the sense whose meaning is `meaning`; `part_of_speech` and `dictionary_notes` are the dictionary's information on that sense."
}

/** A question about one sense: its wording under `question`, the sense's scope beside it. */
const scoped = <Q extends Question>(question: Q, scope: SenseScope, language: Language): Q => ({
  ...question,
  instructions: { question: question.instructions ?? null, focus: FOCUS[language], ...scope }
})

/** The questions about one sense of a word in `language`, each carrying that sense's scope. */
export const scopedSenseQuestions = (scope: SenseScope, language: Language): Record<string, Question> =>
  Object.fromEntries(
    Object.entries(language === "ja" ? senseQuestions : englishSenseQuestions).map(([name, question]) => [
      name,
      scoped(question, scope, language)
    ])
  )

/** English has no keigo, so an English word's similar words can't differ by it. */
const { respectful: _, humble: __, ...ENGLISH_DIFFERENCES } = DIFFERENCES

/**
 * Two questions per candidate: is it a near-synonym of the sense, and how does it differ.
 * Each carries the judged sense's `meaning` and the candidate in its instructions.
 */
export const candidateQuestions = (
  index: number,
  sense: SenseScope,
  candidate: CandidateState,
  language: Language = "ja"
) => {
  const scope = { meaning: sense.meaning, ...candidateScope(candidate) }
  return {
    [`similar_${index}`]: {
      type: "noul",
      instructions: {
        question:
          "Can `candidate_word` express the same meaning as `word` (as described in `meaning`) in at least some sentences?",
        ...scope
      },
      criteria: {
        true: "Yes: it is a near-synonym that could replace it in some sentences",
        false: "No: it is related, but means something different"
      }
    } satisfies NoulQuestion,
    [`difference_${index}`]: {
      type: "choice",
      instructions: {
        question:
          "Compared with `word`, with the meaning in `meaning`, what is the main difference when a native speaker chooses `candidate_word` instead?",
        ...scope
      },
      criteria: language === "ja" ? DIFFERENCES : ENGLISH_DIFFERENCES
    } satisfies ChoiceQuestion
  }
}

/** The key prefix of a sense's questions in an entry's request. */
export const sensePrefix = (sense: number) => `s${sense}_`

/**
 * Every question about an entry's senses in one request: each judged sense's questions and, for
 * the senses that have them, its similar-word candidates, keyed `s{sense}_{name}`.
 */
export const entryRequest = (
  entry: EntryRecord,
  tags: ReadonlyMap<string, string>,
  candidates: ReadonlyArray<ReadonlyArray<CandidateState> | undefined> = []
): { readonly state: EntryType; readonly questions: Record<string, Question> } => {
  const questions: Record<string, Question> = {}
  judgedSenses(entry).forEach((_, index) => {
    const scope = senseScope(entry, index, tags)
    const own: Record<string, Question> = { ...scopedSenseQuestions(scope, entry.language) }
    candidates[index]?.forEach((candidate, j) =>
      Object.assign(own, candidateQuestions(j, scope, candidate, entry.language))
    )
    for (const [name, question] of Object.entries(own)) questions[`${sensePrefix(index)}${name}`] = question
  })
  return { state: entryState(entry), questions }
}

/**
 * An English word's katakana loan candidates, keyed `loanword_{k}` and `loan_{k}`: a drifted
 * loan is the word's trap rather than one sense's. They get a request of their own, whose state
 * is the English word without its senses, since every question sees the whole state: beside
 * the senses' Japanese glosses, any one overlapping the katakana word's meaning (格好 beside
 * スタイル's figure, オートバイ beside バイク) read as the two words meaning the same. Asked the
 * same question without them, スタイル went from 0.69 to 0.86 and バイク from 0.41 to 0.90
 * (docs/nuance-on-english-entries.md).
 */
export const loanRequest = (
  entry: EntryRecord,
  loans: ReadonlyArray<EntryRecord>,
  tags: ReadonlyMap<string, string>
): { readonly state: EntryType; readonly questions: Record<string, Question> } => {
  const { senses: _, ...word } = entryState(entry)
  const questions: Record<string, Question> = {}
  loans
    .slice(0, MAX_LOANS)
    .forEach((candidate, k) => Object.assign(questions, loanQuestions(k, entry, candidate, tags)))
  return { state: word, questions }
}

/** One sense's answers from an entry's request, named as stored: `formality`, …, `similar_0`. */
export const answersOfSense = (answers: Readonly<Record<string, unknown>>, sense: number): Record<string, unknown> => {
  const prefix = sensePrefix(sense)
  return Object.fromEntries(
    Object.entries(answers).flatMap(([name, answer]) =>
      name.startsWith(prefix) ? [[name.slice(prefix.length), answer]] : []
    )
  )
}
