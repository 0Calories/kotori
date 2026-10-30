import type { EntryRecord, LoanCandidate } from "@kotori/db"
import { romanize } from "@kotori/japanese"
import type { ChoiceQuestion, EntryType, NoulQuestion, Question, ScoreQuestion } from "@typesafe-ai/sdk"
import { judgedSenses } from "./state.ts"

/**
 * The judgments Jev makes about the English side of a sense, for Japanese natives learning
 * English. The dimensions differ from the Japanese ones on purpose: a formality slider measured
 * the Japanese way doesn't transfer, and the traps Japanese learners actually fall into
 * (profanity strength, textbook-isms, drifted katakana loanwords) have no Japanese counterpart.
 *
 * They run in their own job, only when a Japanese native views the entry, in one request per
 * entry: each leading gloss of each judged sense is judged on its own, the gloss and its sense
 * carried in the question's instructions. The state is the entry, as on the Japanese side.
 */

/**
 * Bumped whenever an English-side question is added, removed or reworded, or what it sees
 * changes; stored judgments say which set produced them, and outdated ones are re-judged when
 * a Japanese native views the entry. History: 1–2 — asked in the nuance request about each
 * sense's first gloss (they shared QUESTIONS_VERSION); 3 — their own job, judged per gloss,
 * strength and register as Scores, and the katakana loan chosen from candidates the dictionary
 * names instead of recalled.
 */
export const ENGLISH_QUESTIONS_VERSION = 3

/** The English glosses judged per sense; later ones are rarer synonyms. */
export const MAX_GLOSSES = 4
/** Katakana candidates asked about per gloss, most frequent first. */
export const MAX_LOANS = 3

export const STRENGTH_LEVELS = ["none", "mild", "strong", "avoid"] as const
export const REGISTER_LEVELS = ["casual", "neutral", "formal"] as const

const variety: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Is the English word or phrase `english_word` (how dictionaries translate the Japanese word `word`) tied to a regional variety of English?",
  criteria: {
    universal: "Used across varieties of English without marking the speaker",
    american: 'Chiefly American English; British speakers say something else, e.g. "fall" (autumn), "candy", "soccer"',
    british: 'Chiefly British English; American speakers say something else, e.g. "lift" (elevator), "flat", "lorry"'
  }
}

// A Score: offensiveness is a spectrum, and its rare extreme, a slur, gets a level of its own.
const strength: ScoreQuestion = {
  type: "score",
  instructions:
    "How offensive is the English word or phrase `english_word` when used with the meaning in `meaning`? Judge the word itself, not its subject.",
  criteria: [
    {
      what: "Not offensive: ordinary vocabulary that is fine in front of anyone, including plain words for delicate subjects"
    },
    {
      what: "Mildly coarse: fine among friends, but avoided at work, in front of children or in careful speech",
      examples: ["damn", "crap", "screw up"]
    },
    {
      what: "Strong profanity: shocks in most settings and is bleeped on television",
      examples: ["fuck", "shit"]
    },
    { what: "A slur or similarly hateful word that attacks people for who they are; a learner should never use it" }
  ]
}

const currency: ChoiceQuestion = {
  type: "choice",
  instructions:
    "How current does the English word or phrase `english_word`, with the meaning in `meaning`, sound to native speakers today?",
  criteria: {
    current: "Ordinary present-day English",
    dated: 'Understood but old-fashioned; natives rarely say it now, e.g. "whom" in speech, "groovy"',
    textbook:
      'Taught to learners but stiff or odd from a native: phrasebook or textbook English, e.g. "How do you do?", "It is a pen."'
  }
}

// A Score with situations for levels, as the Japanese formality scale has.
const register: ScoreQuestion = {
  type: "score",
  instructions: "What register does the English word or phrase `english_word`, with the meaning in `meaning`, carry?",
  criteria: [
    {
      what: "Casual: conversational or slangy, for friends and family; out of place in formal writing",
      examples: ["wanna", "kids", "guy"]
    },
    { what: "Neutral: plain wording that fits a chat with a friend and a business email alike" },
    {
      what: "Formal: wording for official letters, reports and announcements; stiff in casual conversation",
      examples: ["purchase", "commence", "resides"]
    }
  ]
}

export const glossQuestions = { variety, strength, currency, register }
export type GlossQuestions = typeof glossQuestions

// The スタイル problem: a katakana loan the learner already "knows" whose everyday Japanese
// meaning has drifted from the English source word. Code finds the candidates (glosses and
// JMDict's lsource); Jev selects among them instead of recalling a loan, which it isn't
// trained to do. A gloss match can be a false candidate (トラック has the gloss "lorry", but is
// the loan of "truck"), so a Noul asks whether the pair is a loan at all before the Choice
// about its meaning counts; where JMDict names the English word as the loan's source, its word
// decides. Examples are kept out of the golden set.
const isLoan: NoulQuestion = {
  type: "noul",
  instructions: "Is `katakana_word` the everyday katakana loanword of the English word `english_word`?",
  criteria: {
    true: "Yes: Japanese speakers know `katakana_word` as the word borrowed from `english_word`, whatever it has come to mean in Japanese",
    false:
      "No: it is borrowed from a different English word, or is only another translation of the same Japanese meaning"
  }
}

// Jev took a dictionary translation that repeats the source word (テンション: "tension",
// シール: "seal") for the everyday meaning, so the evidence comes with how to read it.
const LOAN_EVIDENCE =
  "`katakana_meanings` are a dictionary's translations of `katakana_word`, with its usage notes in brackets. They often list the English source word itself even where everyday Japanese uses the word differently: judge how Japanese speakers commonly use it today."

const loan: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Does the everyday Japanese meaning of `katakana_word` match the English word `english_word` with the meaning in `meaning`?",
  criteria: {
    matches:
      "It means essentially the same in everyday Japanese, so a Japanese speaker who knows `katakana_word` understands `english_word` here, e.g. ピアノ for 'piano', バス for 'bus'",
    diverges:
      "Its everyday Japanese meaning differs, so a Japanese speaker who knows `katakana_word` would misread or misuse `english_word` here, e.g. トランプ (playing cards, not 'trump'), コンセント (a power socket, not 'consent')"
  }
}

/** A gloss's evidence, carried in each question about it. Its keys never repeat a state key. */
export const glossScope = (entry: EntryRecord, sense: number, gloss: number) => {
  const glosses = entry.senses[sense]?.glosses ?? []
  return {
    english_word: glosses[gloss]?.text ?? "",
    meaning: glosses.map((own) => own.text).join("; ")
  }
}
export type GlossScope = ReturnType<typeof glossScope>

/** A katakana word that may be a gloss's loan, and how the dictionary ties them. */
export interface LoanCandidateEntry {
  readonly entry: EntryRecord
  readonly by: LoanCandidate["by"]
}

/**
 * A katakana candidate: its spelling, the dictionary's translations of each sense with that
 * sense's usage notes ("tension [physics]"), so the everyday sense stands out, and JMDict's
 * wasei-eigo mark.
 */
export const loanScope = (candidate: EntryRecord, tags: ReadonlyMap<string, string>) => ({
  katakana_word: candidate.headword,
  katakana_meanings: judgedSenses(candidate).map((sense) => {
    const glosses = sense.glosses
      .slice(0, 3)
      .map((own) => own.text)
      .join("; ")
    const notes = [...sense.misc, ...sense.fields].map((code) => tags.get(code) ?? code)
    return notes.length > 0 ? `${glosses} [${notes.join("; ")}]` : glosses
  }),
  ...(candidate.senses.some((sense) => sense.wasei)
    ? { katakana_note: "The dictionary marks it wasei-eigo: English-looking, but coined in Japan" }
    : {})
})

const scoped = <Q extends Question>(question: Q, scope: Record<string, EntryType>): Q => ({
  ...question,
  instructions: { question: question.instructions ?? null, ...scope }
})

/** The key prefix of a gloss's questions in an entry's English request. */
export const glossPrefix = (sense: number, gloss: number) => `s${sense}_g${gloss}_`

/** A judged gloss of an entry: its sense, its position in the sense and its text. */
export interface JudgedGloss {
  readonly sense: number
  readonly gloss: number
  readonly text: string
}

/** The glosses the English side judges: the first `MAX_GLOSSES` of each judged sense. */
export const judgedGlosses = (entry: EntryRecord): ReadonlyArray<JudgedGloss> =>
  judgedSenses(entry).flatMap((sense, index) =>
    sense.glosses.slice(0, MAX_GLOSSES).map((gloss, position) => ({ sense: index, gloss: position, text: gloss.text }))
  )

/** The state every English question sees: the Japanese word, its reading and its senses. */
export const englishState = (entry: EntryRecord) => ({
  word: entry.headword,
  reading: `${entry.reading} (${romanize(entry.reading)})`,
  senses: judgedSenses(entry).map((sense) =>
    sense.glosses
      .slice(0, 3)
      .map((gloss) => gloss.text)
      .join("; ")
  )
})

/**
 * Every English question about an entry in one request, keyed `s{sense}_g{gloss}_{name}`:
 * per judged gloss, the four judgments, and per katakana candidate a `loanword_{k}` Noul and
 * a `loan_{k}` Choice. `candidates` names each gloss's katakana candidates, most frequent first.
 */
export const englishRequest = (
  entry: EntryRecord,
  tags: ReadonlyMap<string, string>,
  candidates: (gloss: JudgedGloss) => ReadonlyArray<LoanCandidateEntry>
): { readonly state: EntryType; readonly questions: Record<string, Question> } => {
  const questions: Record<string, Question> = {}
  for (const judged of judgedGlosses(entry)) {
    const scope = glossScope(entry, judged.sense, judged.gloss)
    const own: Record<string, Question> = {
      variety: scoped(variety, scope),
      strength: scoped(strength, scope),
      currency: scoped(currency, scope),
      register: scoped(register, scope)
    }
    candidates(judged)
      .slice(0, MAX_LOANS)
      .forEach((candidate, k) => {
        const katakana = loanScope(candidate.entry, tags)
        own[`loanword_${k}`] = scoped(isLoan, { english_word: scope.english_word, ...katakana })
        own[`loan_${k}`] = scoped(loan, { ...scope, ...katakana, evidence: LOAN_EVIDENCE })
      })
    for (const [name, question] of Object.entries(own)) {
      questions[`${glossPrefix(judged.sense, judged.gloss)}${name}`] = question
    }
  }
  return { state: englishState(entry), questions }
}

/** One gloss's answers from an entry's English request, named as stored: `variety`, …, `loan_0`. */
export const answersOfGloss = (
  answers: Readonly<Record<string, unknown>>,
  sense: number,
  gloss: number
): Record<string, unknown> => {
  const prefix = glossPrefix(sense, gloss)
  return Object.fromEntries(
    Object.entries(answers).flatMap(([name, answer]) =>
      name.startsWith(prefix) ? [[name.slice(prefix.length), answer]] : []
    )
  )
}
