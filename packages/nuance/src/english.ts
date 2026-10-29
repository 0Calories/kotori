import type { EntryRecord } from "@kotori/db"
import type { ChoiceQuestion } from "@typesafe-ai/sdk"

/**
 * The judgments Jev makes about the English side of a sense, for Japanese natives
 * learning English. The dimensions differ from the Japanese ones on purpose: a
 * formality slider measured the Japanese way doesn't transfer, and the traps
 * Japanese learners actually fall into (profanity strength, textbook-isms,
 * drifted katakana loanwords) have no Japanese counterpart.
 */

/** What Jev is shown: the English word as one meaning of a Japanese headword. */
export const englishState = (entry: EntryRecord, senseIndex: number) => {
  const sense = entry.senses[senseIndex]!
  const [first, ...rest] = sense.glosses.map((gloss) => gloss.text)
  return {
    word: first ?? "",
    ...(rest.length > 0 ? { also_means: rest.slice(0, 3) } : {}),
    japanese_word: `${entry.headword} (${entry.reading})`,
    meaning: sense.glosses
      .slice(0, 3)
      .map((gloss) => gloss.text)
      .join("; ")
  }
}

const variety: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Is the English word or phrase `word` (a translation of the Japanese word `japanese_word`) tied to a regional variety of English?",
  criteria: {
    universal: "Used across varieties of English without marking the speaker",
    american: 'Chiefly American English; British speakers say something else, e.g. "fall" (autumn), "candy", "soccer"',
    british: 'Chiefly British English; American speakers say something else, e.g. "lift" (elevator), "flat", "lorry"'
  }
}

const strength: ChoiceQuestion = {
  type: "choice",
  instructions:
    "How offensive is the English word or phrase `word` when used with the meaning in `meaning`? Judge the word itself, not its subject.",
  criteria: {
    none: "Not offensive: ordinary vocabulary, even about delicate subjects",
    mild: 'Mildly coarse: fine among friends, avoided in careful speech, e.g. "damn", "crap", "screw up"',
    strong: 'Strong profanity: shocks in most settings and gets censored, e.g. "fuck", "shit"',
    avoid: "A slur or similarly hateful word a learner should never use"
  }
}

const currency: ChoiceQuestion = {
  type: "choice",
  instructions:
    "How current does the English word or phrase `word`, with the meaning in `meaning`, sound to native speakers today?",
  criteria: {
    current: "Ordinary present-day English",
    dated: 'Understood but old-fashioned; natives rarely say it now, e.g. "whom" in speech, "groovy"',
    textbook:
      'Taught to learners but stiff or odd from a native: phrasebook or textbook English, e.g. "How do you do?", "It is a pen."'
  }
}

const register: ChoiceQuestion = {
  type: "choice",
  instructions: "What register does the English word or phrase `word`, with the meaning in `meaning`, carry?",
  criteria: {
    casual: 'Conversational or slangy; out of place in formal writing, e.g. "wanna", "kids", "guy"',
    neutral: "Fits almost any situation",
    formal: 'Formal or official; stiff in casual conversation, e.g. "purchase", "commence", "resides"'
  }
}

// The スタイル problem: a katakana loan the learner already "knows" whose everyday
// Japanese meaning has drifted from the English source word. The katakana word itself
// is prose, so Claude names it (loanWord/loanTrap); Jev only judges the relationship.
const loan: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Japanese borrows many English words as katakana loanwords. Consider the common katakana loanword derived from the English word `word`, if Japanese speakers use one. Does its everyday Japanese meaning match the English word's meaning in `meaning`?",
  criteria: {
    no_loan: "There is no common katakana loanword of this English word in everyday Japanese",
    matches: "A common loan exists and means essentially the same, e.g. テーブル for 'table', コーヒー for 'coffee'",
    diverges:
      "A common loan exists but its everyday Japanese meaning differs from this English meaning, e.g. スタイル (figure, not style), マンション (flat, not mansion), カンニング (cheating, not cunning)"
  }
}

export const englishQuestions = {
  variety,
  strength,
  currency,
  register,
  loan
}

export type EnglishQuestions = typeof englishQuestions
