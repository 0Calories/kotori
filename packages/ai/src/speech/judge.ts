import {
  type Casting,
  Formality,
  type Language,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/contracts"
import type { ChoiceQuestion, ChoiceResponse, Question, ScoreQuestion, ScoreResponse } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { SENTENCE_FORMALITY, FORMALITY_QUESTION } from "../coaching/formality.ts"
import { type Jev, JevDeadline, type JevError } from "../providers/Jev.ts"

/**
 * Jev's judgment of the casting signals of sentences nobody wrote for Kotori: those seeded from
 * Tatoeba and Wiktionary, whose sources give no register or speaker. Claude judges the same
 * signals for its own sentences as it writes them (`ExampleWriter`); a seeded sentence is
 * already written, so a typed judgment is all it needs, at a fraction of the cost.
 */

/** A sentence to judge: the side that is voiced, and its translation to pin down what it means. */
export interface SentenceToJudge {
  readonly sentence: string
  readonly translation: string
}

export interface JudgedCasting {
  /** The most probable register, always set: a judged sentence can be voiced. */
  readonly formality: Formality
  readonly casting: Casting
}

/** Sentences per Jev request: five questions each, well inside a request's token limit. */
export const CASTING_BATCH = 10

/**
 * Below this probability a speaker signal is too unsure to steer casting and is dropped: a
 * wrong gender or a child's voice is the most audible miscast, and an unsure "humorous" would
 * send a plain line to a comic voice.
 */
export const CASTING_CONFIDENCE = 0.6

const WHO =
  "Judge from the wording (sentence-final particles, pronouns, vocabulary) and the situation it describes; `translation` gives its meaning."

const choices = <const T extends ChoiceQuestion["criteria"]>(question: string, criteria: T) => ({
  question: `${question} ${WHO}`,
  criteria
})

const QUESTIONS = {
  gender: choices("Who would plausibly say `sentence`: what is the speaker's gender?", {
    masculine: "A man or boy: masculine pronouns, sentence endings or rough wording only men commonly use",
    feminine: "A woman or girl: feminine pronouns, sentence endings or wording mostly women use",
    unspecified: "Nothing in the wording or situation suggests the speaker's gender"
  } satisfies Record<SpeakerGender, string>),
  age: choices("Who would plausibly say `sentence`: how old is the speaker?", {
    child: "A young child: children's words, a child's concerns",
    youth: "A teenager or young adult: school, youth slang, young people's situations",
    adult: "An adult in working life",
    "middle-aged": "A middle-aged person: a parent of grown children, a senior colleague",
    older: "An older person: old-fashioned wording, retirement, grandchildren",
    unspecified: "Nothing in the wording or situation suggests the speaker's age"
  } satisfies Record<SpeakerAge, string>),
  medium: choices("How would `sentence` be delivered aloud?", {
    conversation: "Conversation: someone talking to someone",
    announcement: "Announcement: news, notices, public address, business mail read aloud",
    narration: "Narration: prose, proverbs, descriptions, a story being told"
  } satisfies Record<SentenceMedium, string>),
  tone: choices("What is the dominant feel of `sentence` as it would be said?", {
    neutral: "Neutral: plain, matter-of-fact",
    cheerful: "Cheerful: bright, happy, enthusiastic",
    serious: "Serious: grave, earnest, solemn",
    gentle: "Gentle: soft, kind, soothing",
    rough: "Rough: blunt, harsh, angry",
    humorous: "Humorous: a joke, gag, pun or comic exaggeration"
  } satisfies Record<SentenceTone, string>)
}

/** One sentence's questions, keyed `s{index}_{signal}`, each carrying the sentence beside its wording. */
const sentenceQuestions = (index: number, { sentence, translation }: SentenceToJudge): Record<string, Question> => ({
  [`s${index}_formality`]: {
    type: "score",
    instructions: { question: FORMALITY_QUESTION, sentence, translation },
    criteria: SENTENCE_FORMALITY
  } satisfies ScoreQuestion,
  ...Object.fromEntries(
    Object.entries(QUESTIONS).map(([signal, { question, criteria }]) => [
      `s${index}_${signal}`,
      { type: "choice", instructions: { question, sentence, translation }, criteria } satisfies ChoiceQuestion
    ])
  )
})

/**
 * The most probable level of a score answer, not its expected score: casual-or-polite isn't
 * neutral. Null when the answer is missing or names no level, so the sentence stays unjudged.
 */
const levelOf = (answer: ScoreResponse | undefined): Formality | null => {
  if (answer?.type !== "score") return null
  const levels = Formality.literals
  const [best] = Object.entries((answer.probabilities as Readonly<Record<string, number>> | undefined) ?? {}).toSorted(
    (a, b) => b[1] - a[1]
  )
  const index = best === undefined ? Math.round(answer.score) : Number(best[0])
  return Number.isInteger(index) ? levels[Math.min(Math.max(index, 0), levels.length - 1)]! : null
}

/** The choice when it is one of `allowed` and sure enough, else null. */
const sureChoice = <A extends string>(answer: ChoiceResponse | undefined, allowed: ReadonlyArray<A>): A | null => {
  if (answer === undefined || !allowed.includes(answer.choice as A)) return null
  const probability = (answer.probabilities as Readonly<Record<string, number>>)[answer.choice] ?? answer.confidence
  return probability >= CASTING_CONFIDENCE ? (answer.choice as A) : null
}

const judgeBatch = (jev: Jev["Service"], language: Language, batch: ReadonlyArray<SentenceToJudge>) =>
  jev
    .ask(
      { sentence_language: language === "ja" ? "Japanese" : "English" },
      Object.assign({}, ...batch.map((sentence, index) => sentenceQuestions(index, sentence))),
      // The worker's audio job asks this; nobody is waiting.
      { timeout: JevDeadline.bulk }
    )
    .pipe(
      Effect.map(({ answers }) => {
        const all = answers as Readonly<Record<string, ScoreResponse | ChoiceResponse | undefined>>
        return batch.map((_, index): JudgedCasting | null => {
          const choice = (signal: string) => all[`s${index}_${signal}`] as ChoiceResponse | undefined
          const formality = levelOf(all[`s${index}_formality`] as ScoreResponse | undefined)
          if (formality === null) return null
          return {
            formality,
            casting: {
              speakerGender: sureChoice(choice("gender"), SpeakerGender.literals) ?? "unspecified",
              speakerAge: sureChoice(choice("age"), SpeakerAge.literals) ?? "unspecified",
              medium: sureChoice(choice("medium"), SentenceMedium.literals),
              // A seeded sentence's dialect is its sense's, which casting reads from the sense's labels.
              variety: null,
              tone: sureChoice(choice("tone"), SentenceTone.literals)
            }
          }
        })
      })
    )

/**
 * Each sentence's formality and casting, in order, judged by Jev in requests of `CASTING_BATCH`
 * sentences (one request for a typical entry). Fails as a whole on any Jev error: an unjudged
 * sentence keeps no formality, and is not voiced. A sentence whose formality answer is missing or
 * malformed is null, unjudged, and the rest are judged.
 */
export const judgeCasting = (
  jev: Jev["Service"],
  language: Language,
  sentences: ReadonlyArray<SentenceToJudge>
): Effect.Effect<ReadonlyArray<JudgedCasting | null>, JevError> => {
  const batches: Array<ReadonlyArray<SentenceToJudge>> = []
  for (let start = 0; start < sentences.length; start += CASTING_BATCH) {
    batches.push(sentences.slice(start, start + CASTING_BATCH))
  }
  return Effect.forEach(batches, (batch) => judgeBatch(jev, language, batch)).pipe(
    Effect.map((judged) => judged.flat()),
    Effect.withSpan("judgeCasting", { attributes: { sentences: sentences.length, requests: batches.length } })
  )
}
