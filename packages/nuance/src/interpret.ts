import type {
  AgeGroup,
  Connotation,
  Currency,
  Difference,
  Formality,
  Gender,
  JudgmentSource,
  Keigo,
  Medium,
  Nuance,
  RegisterShape
} from "@kotori/domain"
import type { ChoiceResponse, NoulResponse, ScoreResponse, SystemOneResult } from "@typesafe-ai/sdk"
import { FORMALITY_LEVELS, MEDIUM_LEVELS, type SenseQuestions } from "./questions.ts"

export type SenseAnswers = SystemOneResult<SenseQuestions>["answers"]

/**
 * JMDict's editors tag many senses with usage notes (hon, col, male, arch…).
 * Those are authoritative, so they override Jev wherever they speak to a
 * dimension; Jev fills in everything the tags don't cover.
 */
const firstTag = <A>(tags: ReadonlyArray<string>, table: ReadonlyArray<readonly [string, A]>): A | undefined =>
  table.find(([tag]) => tags.includes(tag))?.[1]

const FORMALITY_TAGS: ReadonlyArray<readonly [string, Formality]> = [
  ["vulg", "vulgar"],
  ["X", "vulgar"],
  ["hon", "formal"],
  ["hum", "formal"],
  ["form", "formal"],
  ["pol", "polite"],
  ["sl", "casual"],
  ["net-sl", "casual"],
  ["m-sl", "casual"],
  ["col", "casual"],
  ["fam", "casual"],
  ["chn", "casual"]
]

const MEDIUM_TAGS: ReadonlyArray<readonly [string, Medium]> = [
  ["col", "spoken"],
  ["sl", "spoken"],
  ["net-sl", "spoken"],
  ["fam", "spoken"],
  ["form", "written"],
  ["poet", "written"]
]

const KEIGO_TAGS: ReadonlyArray<readonly [string, Keigo]> = [
  ["hon", "sonkeigo"],
  ["hum", "kenjougo"],
  ["pol", "teineigo"]
]

const GENDER_TAGS: ReadonlyArray<readonly [string, Gender]> = [
  ["male", "masculine"],
  ["fem", "feminine"]
]
const AGE_TAGS: ReadonlyArray<readonly [string, AgeGroup]> = [
  ["chn", "children"],
  ["net-sl", "youth"],
  ["m-sl", "youth"]
]
const CURRENCY_TAGS: ReadonlyArray<readonly [string, Currency]> = [
  ["arch", "archaic"],
  ["obs", "archaic"],
  ["dated", "dated"]
]
const CONNOTATION_TAGS: ReadonlyArray<readonly [string, Connotation]> = [
  ["derog", "negative"],
  ["vulg", "negative"]
]
const SLANG_TAGS = ["sl", "net-sl", "m-sl"]
/** Tags whose words sit at one obvious register, so a slider is the wrong model. */
const FIXED_SHAPE_TAGS: ReadonlyArray<readonly [string, RegisterShape]> = [
  ["vulg", "fixed"],
  ["X", "fixed"],
  ["derog", "fixed"]
]

const scale = <L extends string>(levels: ReadonlyArray<L>, answer: ScoreResponse, tagged: L | undefined) => {
  const last = levels.length - 1
  if (tagged !== undefined) {
    return { value: tagged, position: levels.indexOf(tagged) / last, confidence: 1, source: "jmdict" as JudgmentSource }
  }
  const index = Math.min(Math.max(Math.round(answer.score), 0), last)
  return {
    value: levels[index]!,
    position: Math.min(Math.max(answer.score / last, 0), 1),
    confidence: answer.confidence,
    source: "jev" as JudgmentSource
  }
}

const choice = <L extends string>(answer: ChoiceResponse, tagged: L | undefined) =>
  tagged !== undefined
    ? { value: tagged, confidence: 1, source: "jmdict" as JudgmentSource }
    : { value: answer.choice as L, confidence: answer.confidence, source: "jev" as JudgmentSource }

/**
 * "Sounds stiff between friends" is a function of the register judgments, not a question
 * of its own: asked directly, Jev kept judging whether the *topic* was awkward to raise
 * rather than the register (see the history on `stiffWithFriends` in questions.ts). A word
 * is stiff among friends when it is formal, respectful or humble keigo, or lives in
 * written language; the probability is the confidence of whichever judgment says so.
 */
const stiffBetweenFriends = (
  formality: Nuance["formality"],
  medium: Nuance["medium"],
  keigo: Nuance["keigo"]
): number =>
  Math.max(
    formality.value === "formal" ? formality.confidence : 0,
    keigo.value === "sonkeigo" || keigo.value === "kenjougo" ? keigo.confidence : 0,
    medium.value === "written" ? medium.confidence : 0
  )

/** Combines Jev's answers for a sense with its JMDict tags into the nuance shown to learners. */
export const interpretSense = (answers: SenseAnswers, misc: ReadonlyArray<string>): Nuance => {
  const formality = scale(FORMALITY_LEVELS, answers.formality, firstTag(misc, FORMALITY_TAGS))
  const medium = scale(MEDIUM_LEVELS, answers.medium, firstTag(misc, MEDIUM_TAGS))
  const keigo = choice<Keigo>(answers.keigo, firstTag(misc, KEIGO_TAGS))
  // Answers recorded before questions version 2 have no registerShape; the field stays
  // absent and the app falls back to its pre-shape heuristics for those rows.
  const shape = answers.registerShape as ChoiceResponse | undefined
  return {
    formality,
    medium,
    keigo,
    gender: choice<Gender>(answers.gender, firstTag(misc, GENDER_TAGS)),
    age: choice<AgeGroup>(answers.age, firstTag(misc, AGE_TAGS)),
    currency: choice<Currency>(answers.currency, firstTag(misc, CURRENCY_TAGS)),
    connotation: choice<Connotation>(answers.connotation, firstTag(misc, CONNOTATION_TAGS)),
    ...(shape === undefined ? {} : { registerShape: choice<RegisterShape>(shape, firstTag(misc, FIXED_SHAPE_TAGS)) }),
    cautions: {
      rudeToSuperiors: answers.rudeToSuperiors.noul,
      stiffWithFriends: stiffBetweenFriends(formality, medium, keigo),
      slang: misc.some((tag) => SLANG_TAGS.includes(tag)) ? 1 : answers.slang.noul
    }
  }
}

export interface SimilarJudgment {
  readonly similarId: number
  readonly similarity: number
  readonly difference: Difference
  readonly confidence: number
}

/** Keeps candidates Jev judges to be near-synonyms (p >= 0.5), most similar first. */
export const interpretCandidates = (
  answers: Readonly<Record<string, unknown>>,
  candidateIds: ReadonlyArray<number>
): Array<SimilarJudgment> =>
  candidateIds
    .flatMap((similarId, index) => {
      const similar = answers[`similar_${index}`] as NoulResponse | undefined
      const difference = answers[`difference_${index}`] as ChoiceResponse | undefined
      if (similar === undefined || difference === undefined || similar.noul < 0.5) return []
      return [
        {
          similarId,
          similarity: similar.noul,
          difference: difference.choice as Difference,
          confidence: difference.confidence
        }
      ]
    })
    .sort((a, b) => b.similarity - a.similarity)
