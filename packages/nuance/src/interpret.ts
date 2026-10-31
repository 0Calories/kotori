import {
  type AgeGroup,
  type Connotation,
  type Currency,
  type Difference,
  type Gender,
  type JudgmentSource,
  type Keigo,
  type LoanMeaning,
  loanShown,
  type LoanVerdict,
  type Nuance,
  type RegisterShape,
  SLANG_TAGS,
  TAG_JUDGMENTS,
  type Variety
} from "@kotori/domain"
import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk"
import { PROFANITY_LEVELS } from "./english.ts"
import { FORMALITY_LEVELS, MEDIUM_LEVELS, REVERSED } from "./questions.ts"

/**
 * Jev's answers about one sense of a word in either language, by question name. Answers stored
 * before a question existed lack it: registerShape before version 2, the English-only ones
 * before English words' version 3. Japanese words have keigo; English ones never do.
 */
export interface SenseAnswers {
  readonly formality: ScoreResponse
  readonly medium: ScoreResponse
  readonly keigo?: ChoiceResponse
  readonly gender: ChoiceResponse
  readonly age: ChoiceResponse
  readonly currency: ChoiceResponse
  readonly connotation: ChoiceResponse
  readonly registerShape?: ChoiceResponse
  readonly rudeToSuperiors: NoulResponse
  /** Asked before version 2 (Japanese) or 3 (English); derived from the register now, never read. */
  readonly stiffWithFriends?: NoulResponse
  readonly slang: NoulResponse
  readonly variety?: ChoiceResponse
  readonly profanity?: ScoreResponse
  readonly textbook?: NoulResponse
}

/**
 * The dictionary's editors tag many senses with usage notes (hon, col, male, arch…; the English
 * dictionary maps Wiktionary's and EJDict's labels to the same codes, and its regions to en-US
 * and en-GB). Those are authoritative, so they override Jev wherever they speak to a dimension
 * (`TAG_JUDGMENTS`); Jev fills in everything the tags don't cover.
 */
const firstTag = <A>(tags: ReadonlyArray<string>, table: ReadonlyArray<readonly [string, A]>): A | undefined =>
  table.find(([tag]) => tags.includes(tag))?.[1]

/** A sense's tags as `interpretSense` reads them: its usage notes and where it is said. */
export const senseTags = (sense: {
  readonly misc: ReadonlyArray<string>
  readonly dialects: ReadonlyArray<string>
}) => [...sense.misc, ...sense.dialects]

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

/** A Score as a label: the level its score rounds to, as the Score docs endorse for one outcome. */
const level = <L extends string>(levels: ReadonlyArray<L>, answer: ScoreResponse) => ({
  value: levels[Math.min(Math.max(Math.round(answer.score), 0), levels.length - 1)]!,
  confidence: answer.confidence,
  source: "jev" as JudgmentSource
})

/**
 * "Sounds stiff between friends" is a function of the register judgments, not a question
 * of its own: asked directly, Jev kept judging whether the *topic* was awkward to raise
 * rather than the register (see the history on `QUESTIONS_VERSION` in questions.ts). A word
 * is stiff among friends when it is formal, respectful or humble keigo, or lives in
 * written language; the probability is the most Jev puts on any of those, and a dictionary
 * tag decides outright. English words have no keigo. Jev's `confidence` measures how peaked
 * an answer is, not how likely a label is: a word split between 尊敬語 and 謙譲語 is unsure
 * which keigo it is, but sure it is keigo. A sense the dictionary files under a field
 * (physics, medicine…) is written because of its subject, not its register, so its medium
 * doesn't count: "tension" in physics, 張力 and 電圧, was marked stiff between friends.
 */
const stiffBetweenFriends = (
  answers: SenseAnswers,
  formality: Nuance["formality"],
  medium: Nuance["medium"],
  keigo: Nuance["keigo"],
  technical: boolean
): number =>
  Math.max(
    formality.source === "jmdict"
      ? Number(formality.value === "formal")
      : (answers.formality.probabilities[FORMALITY_LEVELS.indexOf("formal")] ?? 0),
    keigo.source === "jmdict" || answers.keigo === undefined
      ? Number(keigo.value === "sonkeigo" || keigo.value === "kenjougo")
      : (answers.keigo.probabilities["sonkeigo"] ?? 0) + (answers.keigo.probabilities["kenjougo"] ?? 0),
    medium.source === "jmdict"
      ? Number(medium.value === "written")
      : technical
        ? 0
        : (answers.medium.probabilities[MEDIUM_LEVELS.indexOf("written")] ?? 0)
  )

/** English has no keigo; the dictionary is certain of it. */
const NO_KEIGO = { value: "none", confidence: 1, source: "jmdict" } as const

/**
 * Combines Jev's answers for a sense with its dictionary tags (`senseTags`) and fields (physics,
 * medicine…) into the nuance shown to learners. English words also get their regional variety,
 * profanity and the textbook caution.
 */
export const interpretSense = (
  answers: SenseAnswers,
  tags: ReadonlyArray<string>,
  fields: ReadonlyArray<string> = []
): Nuance => {
  const formality = scale(FORMALITY_LEVELS, answers.formality, firstTag(tags, TAG_JUDGMENTS.formality))
  const medium = scale(MEDIUM_LEVELS, answers.medium, firstTag(tags, TAG_JUDGMENTS.medium))
  const keigo =
    answers.keigo === undefined ? NO_KEIGO : choice<Keigo>(answers.keigo, firstTag(tags, TAG_JUDGMENTS.keigo))
  // Answers recorded before questions version 2 have no registerShape; the field stays
  // absent and the app falls back to its pre-shape heuristics for those rows.
  const shape = answers.registerShape
  return {
    formality,
    medium,
    keigo,
    gender: choice<Gender>(answers.gender, firstTag(tags, TAG_JUDGMENTS.gender)),
    age: choice<AgeGroup>(answers.age, firstTag(tags, TAG_JUDGMENTS.age)),
    currency: choice<Currency>(answers.currency, firstTag(tags, TAG_JUDGMENTS.currency)),
    connotation: choice<Connotation>(answers.connotation, firstTag(tags, TAG_JUDGMENTS.connotation)),
    ...(shape === undefined
      ? {}
      : { registerShape: choice<RegisterShape>(shape, firstTag(tags, TAG_JUDGMENTS.registerShape)) }),
    cautions: {
      rudeToSuperiors: answers.rudeToSuperiors.noul,
      stiffWithFriends: stiffBetweenFriends(answers, formality, medium, keigo, fields.length > 0),
      slang: tags.some((tag) => SLANG_TAGS.includes(tag)) ? 1 : answers.slang.noul,
      ...(answers.textbook === undefined ? {} : { textbook: answers.textbook.noul })
    },
    ...(answers.variety === undefined
      ? {}
      : { variety: choice<Variety>(answers.variety, firstTag(tags, TAG_JUDGMENTS.variety)) }),
    ...(answers.profanity === undefined ? {} : { profanity: level(PROFANITY_LEVELS, answers.profanity) })
  }
}

/**
 * How likely a katakana candidate must be the English word's loanword for its verdict to count:
 * the docs' starting point for a yes. A false warning costs trust in the very feature meant to
 * build it (docs/nuance-rework.md C3), so tune it on the eval before lowering it.
 */
export const LOAN_IS = 0.7

/**
 * A stored loan the app shows as drifted whose warning Claude hasn't written: it was judged while
 * Claude was unavailable (no key, a bad one, or a probe that timed out).
 */
export const awaitsWarning = (
  loan:
    | {
        readonly word: string | null
        readonly verdict: LoanVerdict | null
        readonly trap: string | null
      }
    | undefined
): boolean =>
  loan !== undefined &&
  loan.word !== null &&
  loan.trap === null &&
  loan.verdict !== null &&
  loanShown(loan.verdict) === "warning"

/** A katakana word asked about as an English word's loan, and how the dictionary ties them. */
export interface AskedLoan {
  readonly word: string
  readonly by: "gloss" | "source"
}

/** An English word's katakana loan as judged; both null when no candidate is likely enough. */
export interface LoanReading {
  readonly word: string | null
  readonly verdict: LoanVerdict | null
}

const LOAN_MEANINGS: ReadonlyArray<LoanMeaning> = ["same", "divergent", "not_english"]

/**
 * How likely each meaning of the `k`th candidate is: the probabilities of its `loan_{k}` Choice
 * averaged with those of `loan_{k}~reversed`, the same Choice with its options in reverse order,
 * since Jev leans toward the option listed first. Undefined unless both were answered.
 */
export const loanMeanings = (
  answers: Readonly<Record<string, unknown>>,
  k: number
): Record<LoanMeaning, number> | undefined => {
  const forward = answers[`loan_${k}`] as ChoiceResponse | undefined
  const backward = answers[`loan_${k}${REVERSED}`] as ChoiceResponse | undefined
  if (forward === undefined || backward === undefined) return undefined
  const mean = (meaning: LoanMeaning) =>
    ((forward.probabilities[meaning] ?? 0) + (backward.probabilities[meaning] ?? 0)) / 2
  return { same: mean("same"), divergent: mean("divergent"), not_english: mean("not_english") }
}

/**
 * A loan's verdict: its likeliest meaning and that meaning's probability, which the display rule
 * reads (`loanShown`), rather than a Choice's confidence, which says how peaked the answer is.
 * Only the likeliest meaning can reach the 0.7 the app shows at, so the rule needs no other.
 */
const loanVerdict = (meanings: Record<LoanMeaning, number>): Omit<LoanVerdict, "source"> => {
  const value = LOAN_MEANINGS.reduce((best, meaning) => (meanings[meaning] > meanings[best] ? meaning : best))
  return { value, probability: meanings[value] }
}

/**
 * An English word's katakana loan, from Jev's answers about its candidates, in the order of their
 * `loanword_{k}` and `loan_{k}` questions: the likeliest to be its loanword (certainly one JMDict
 * names the English word as the source of, otherwise as likely as Jev judges it), with Jev's
 * verdict on whether it means what the English word does. With no candidate, or none likely
 * enough, there is no loan to warn about.
 */
export const interpretLoan = (
  answers: Readonly<Record<string, unknown>>,
  candidates: ReadonlyArray<AskedLoan>,
  loanIs = LOAN_IS
): LoanReading => {
  const likeliest = candidates
    .map(({ word, by }, k) => ({
      word,
      k,
      p: by === "source" ? 1 : ((answers[`loanword_${k}`] as NoulResponse | undefined)?.noul ?? 0)
    }))
    .reduce<{ word: string; k: number; p: number } | undefined>(
      (best, candidate) => (best === undefined || candidate.p > best.p ? candidate : best),
      undefined
    )
  const meanings = likeliest !== undefined && likeliest.p >= loanIs ? loanMeanings(answers, likeliest.k) : undefined
  return likeliest === undefined || meanings === undefined
    ? { word: null, verdict: null }
    : { word: likeliest.word, verdict: { ...loanVerdict(meanings), source: "jev" } }
}

export interface SimilarJudgment {
  readonly similarId: number
  readonly similarity: number
  readonly difference: Difference
  readonly confidence: number
}

/**
 * How likely a candidate must be a near-synonym to be kept: the docs' starting point for a
 * yes, since 0.5 is a coin flip. On the golden pairs it kept every near-synonym and no
 * unrelated word with jev-1.14.0 (`kotori eval nuance`).
 */
export const SIMILAR_KEPT = 0.7

/** Keeps candidates Jev judges to be near-synonyms, most similar first. */
export const interpretCandidates = (
  answers: Readonly<Record<string, unknown>>,
  candidateIds: ReadonlyArray<number>
): Array<SimilarJudgment> =>
  candidateIds
    .flatMap((similarId, index) => {
      const similar = answers[`similar_${index}`] as NoulResponse | undefined
      const difference = answers[`difference_${index}`] as ChoiceResponse | undefined
      if (similar === undefined || difference === undefined || similar.noul < SIMILAR_KEPT) return []
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
