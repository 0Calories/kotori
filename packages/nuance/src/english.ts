import type { EntryRecord, LoanCandidate } from "@kotori/db"
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk"
import { CONNOTATIONS, REVERSED, reversedChoice, SUBJECT_NOT_REGISTER } from "./questions.ts"
import { judgedSenses } from "./state.ts"

/**
 * The judgments Jev makes about each sense of an English word, for Japanese speakers learning
 * English: the Japanese questions' counterparts, without keigo, which English doesn't have, and
 * the traps Japanese learners fall into that Japanese words don't have (regional variety,
 * profanity strength, textbook English, and drifted katakana loans). The meaning Jev reads is the
 * Japanese gloss, so each question says which language is which.
 */

/**
 * Bumped whenever a question about English words is added, removed or reworded, or what it
 * sees changes; stored judgments say which set produced them (`QUESTIONS_VERSION` is the
 * Japanese set's). History: 1 — the set English words launched with, one request per sense
 * (rows stored before question versions had a column are version 1); 3 — one request per
 * entry, each question carrying its sense's scope, as the Japanese set's version 3 does, with
 * registerShape, regional variety, profanity, textbook English and the katakana loan added, and
 * stiffWithFriends derived instead of asked; 4 — the katakana loan asked in a request of its
 * own, whose state leaves out the word's Japanese senses, and whether it misleads asked as a
 * Noul instead of a Choice; 5 — whether it means the same, has drifted or isn't English asked
 * as a Choice of the three; 6 — that Choice asked in both option orders and read from the two
 * together (docs/nuance-on-english-entries.md).
 */
export const ENGLISH_QUESTIONS_VERSION = 6

export const PROFANITY_LEVELS = ["none", "mild", "strong", "avoid"] as const

/** Katakana loan candidates asked about per English word, most frequent first. */
export const MAX_LOANS = 3

const formality: ScoreQuestion = {
  type: "score",
  instructions:
    "How formal does the English word `word` sound when a native speaker uses it with the meaning in `meaning` (written in Japanese)? Judge the English word, not the Japanese gloss.",
  criteria: [
    {
      what: "Vulgar or crude: rude, insulting or coarse; it would offend strangers or superiors",
      examples: ["piss off", "crap", "bullshit"]
    },
    {
      what: "Casual: relaxed or slangy, for friends and family; too familiar for a boss or a stranger",
      examples: ["gonna", "yeah", "kid", "awesome"]
    },
    {
      what: "Neutral: plain everyday wording that fits almost any situation",
      examples: ["walk", "school", "big", "time"]
    },
    {
      what: "Polite: courteous wording suited to strangers, customers or superiors",
      examples: ["pardon", "would you mind", "restroom"]
    },
    {
      what: "Formal: business, official or ceremonial wording for speeches, letters and official settings",
      examples: ["commence", "hereby", "deceased", "inquire"]
    }
  ]
}

const medium: ScoreQuestion = {
  type: "score",
  instructions: `Where is the English word \`word\`, with the meaning in \`meaning\` (written in Japanese), typically used: in conversation or in writing? ${SUBJECT_NOT_REGISTER}`,
  criteria: [
    {
      what: "Mostly spoken: conversational words that look out of place in formal writing",
      examples: ["yeah", "gonna", "kind of", "stuff"]
    },
    {
      what: "Equally common in conversation and in writing, including everyday words for health, the body and sex",
      examples: ["walk", "time", "friend", "pregnant"]
    },
    {
      what: "Mostly written: literary, journalistic, academic, legal or technical prose; sounds stiff or bookish aloud",
      examples: ["thus", "hereby", "aforementioned", "notwithstanding"]
    }
  ]
}

const gender: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Do English speakers associate the word `word`, with the meaning in `meaning` (written in Japanese), with a particular gender?",
  criteria: {
    neutral: "Used naturally by speakers of any gender",
    masculine: "Sounds typically masculine; mostly used by men or boys, e.g. dude, bro, my man",
    feminine:
      "Sounds typically feminine; mostly used by women or girls, e.g. hun, adorbs, girlfriend (for a female friend)"
  }
}

const age: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Is the English word `word`, with the meaning in `meaning` (written in Japanese), typical of a particular age group of speakers?",
  criteria: {
    any: "Used by people of all ages, including formal and business words that working adults of every age use, e.g. regarding, appreciate",
    children: "Childish or baby talk, used by or to small children, e.g. tummy, doggy, potty",
    youth: "Youth or internet slang, used mostly by teenagers and young adults, e.g. lit, sus, no cap, slay",
    older: "Mainly used by older people; sounds old-fashioned coming from someone young, e.g. groovy, swell, icebox"
  }
}

const currency: ChoiceQuestion = {
  type: "choice",
  instructions:
    "How current does the English word `word`, with the meaning in `meaning` (written in Japanese), feel in present-day English?",
  criteria: {
    current: "In ordinary use today, including formal, written and business words, e.g. regarding, appreciate, hereby",
    trendy: "A recent coinage or buzzword, e.g. rizz, doomscrolling",
    dated: "Understood, but sounds old-fashioned in today's speech and writing, e.g. groovy, swell, icebox",
    archaic:
      "Archaic or obsolete: found in old texts or historical settings, not modern use, e.g. thou, whence, betwixt"
  }
}

const connotation: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Beyond its literal meaning in `meaning` (written in Japanese), what feeling does the English word `word` carry?",
  criteria: CONNOTATIONS
}

/** The Japanese question's counterpart: a slider is the wrong model for words with no choice of register. */
const registerShape: ChoiceQuestion = {
  type: "choice",
  instructions: `Does the English word \`word\`, with the meaning in \`meaning\` (written in Japanese), genuinely vary along a casual-to-formal scale, or is its register fixed or split? ${SUBJECT_NOT_REGISTER}`,
  criteria: {
    scaled:
      "Ordinary vocabulary whose politeness depends on how it is used; it fits somewhere on a casual-to-formal scale, e.g. walk, time, awesome, restroom",
    fixed:
      "Its register is invariant and obvious from what it means: insults, crude words, and ceremonial or ritual wording that never leaves its setting, e.g. moron, piss off, hereby",
    split:
      "It lives in two registers at once with little in between: clinical, technical or official in one world, crude or joking in everyday talk, e.g. erection, intercourse"
  }
}

// As on the Japanese side, the judgment records the fact even when it is obvious; whether
// to show the caution is display policy.
const rudeToSuperiors: NoulQuestion = {
  type: "noul",
  instructions:
    "Someone talking to their boss or a customer uses the English word `word` (meaning `meaning`, written in Japanese). Is choosing this word rude, crude or overly familiar? Answer yes even when that is obvious from the meaning (insults, vulgar words): record the fact, not whether it needs saying.",
  criteria: {
    true: "Yes: the word itself is rough, slangy or overly familiar, so it sounds rude or too casual with a boss or customer, e.g. yeah, gonna, dude, crap",
    false: "No: it is acceptable with a boss or customer, even if a more formal word exists, e.g. yes, get, big, thanks"
  }
}

// "Sounds stiff between friends" is derived from the register judgments, as on the Japanese
// side: on the golden English words the derivation was right 11 times of 12, the question this
// replaced (formal, official, academic or clinical language?) 10 of 12.

const slang: NoulQuestion = {
  type: "noul",
  instructions:
    "Is the English word `word`, with the meaning in `meaning` (written in Japanese), slang (including youth or internet slang)?",
  criteria: {
    true: "Yes: it is slang, e.g. lit, sus, bucks (for dollars), dope (for great)",
    false: "No: it is standard vocabulary, even if casual, e.g. kid, guy, awesome, pretty (for quite)"
  }
}

const variety: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Is the English word `word`, with the meaning in `meaning` (written in Japanese), tied to a regional variety of English?",
  criteria: {
    universal: "Used across varieties of English without marking the speaker",
    american: 'Chiefly American English; British speakers say something else, e.g. "fall" (autumn), "candy", "soccer"',
    british: 'Chiefly British English; American speakers say something else, e.g. "lift" (elevator), "flat", "lorry"'
  }
}

// A Score: offensiveness is a spectrum, and its rare extreme, a slur, gets a level of its own.
const profanity: ScoreQuestion = {
  type: "score",
  instructions:
    "How offensive is the English word `word` when used with the meaning in `meaning` (written in Japanese)? Judge the word itself, not its subject.",
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

const textbook: NoulQuestion = {
  type: "noul",
  instructions:
    "Is the English word or phrase `word`, with the meaning in `meaning` (written in Japanese), wording that learners are taught but that native speakers rarely use today, so it sounds stiff or odd from a native?",
  criteria: {
    true: 'Yes: phrasebook or textbook English that natives seldom say, e.g. "How do you do?", "It is a pen."',
    false: 'No: natives use it, e.g. "Nice to meet you", "I\'m good", "a pen"'
  }
}

export const englishSenseQuestions = {
  formality,
  medium,
  gender,
  age,
  currency,
  connotation,
  registerShape,
  rudeToSuperiors,
  slang,
  variety,
  profanity,
  textbook
}

export type EnglishSenseQuestions = typeof englishSenseQuestions

// The スタイル problem: a katakana loan the learner already "knows" whose everyday Japanese
// meaning has drifted from the English word. Code finds the candidates (JMDict's katakana
// words with the English word as a gloss, or as their lsource); Jev selects among them
// instead of recalling a loan, which it isn't trained to do. A gloss match can be a false
// candidate (トラック has the gloss "lorry", but is the loan of "truck"), so a Noul asks
// whether the pair is a loan at all before the Choice about its meaning counts; where JMDict
// names the English word as the loan's source, its word decides. Examples are kept out of
// the golden set. The trap is a word's, not a sense's, so the loan is judged once per word,
// in a request of its own (`loanRequest`): beside the word's Japanese senses, Jev read any
// sense overlapping the katakana word's meaning (格好 beside スタイル's figure, オートバイ beside
// バイク, サインする beside サイン) as the two words meaning the same.
// On an English word the katakana word is often one of its Japanese translations (テーブル for
// "table"), so "only another translation" can't be the "no": asked that way, Jev said no to
// テーブル at 0.04. The false candidates the Noul is for are loans of other English words. Both
// questions name the English word in their own instructions (`english_word`): with only the
// state's `word`, beside its Japanese senses, Jev still put テーブル, ドア and スタイル below 0.2.
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
// figure, so a learner says "she has a good style". Asked only about the meaning it shares
// with the English word, which a candidate found by gloss always does, Jev called スタイル,
// ジュース and ナイーブ matches, so the options weigh every common use of the katakana word.
// Asked whether every use matched "with the same feeling", Jev found some difference in nearly
// every loan, so small differences don't count. "Same" is using the English word wherever the
// katakana one is used: described as every common use being a meaning the English word has, it
// gave "same meaning" chips to サイン (an autograph) and ナイーブ. Asked whether the loan has "a
// different meaning altogether", Jev leaned toward total mismatches, and サイン, which shares
// "sign", fell from p 0.70 to 0.61, so it asks whether the loan has come to mean something
// different. "Not English" takes about 1% from true loans, but gets under 0.25 even on loans
// JMDict derives from German or Dutch (docs/nuance-on-english-entries.md). The app reads the
// probability of each meaning (`loanShown`), averaged over the Choice asked in both option
// orders: Jev leans toward the option listed first, and `same` gained 0.02 on average reversed.
const loan: ChoiceQuestion = {
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

/** A katakana word that may be an English word's loan, and how the dictionary ties them. */
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

/**
 * The questions about the English word's `k`th katakana candidate: `loanword_{k}` (a Noul: is it
 * the word's loan?) and `loan_{k}` (a Choice: same, divergent or not English), asked again with
 * its options reversed as `loan_{k}~reversed`.
 */
export const loanQuestions = (
  k: number,
  english: EntryRecord,
  candidate: EntryRecord,
  tags: ReadonlyMap<string, string>
) => {
  const katakana = { english_word: english.headword, ...loanScope(candidate, tags) }
  const meaning: ChoiceQuestion = {
    ...loan,
    instructions: { question: loan.instructions ?? null, ...katakana, evidence: LOAN_EVIDENCE }
  }
  return {
    [`loanword_${k}`]: { ...isLoan, instructions: { question: isLoan.instructions ?? null, ...katakana } },
    [`loan_${k}`]: meaning,
    [`loan_${k}${REVERSED}`]: reversedChoice(meaning)
  } satisfies Record<string, NoulQuestion | ChoiceQuestion>
}

/** The loan answers of an English word's request, named as stored: `loanword_0`, `loan_0`, `loan_0~reversed`, …. */
export const answersOfLoans = (answers: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(answers).filter(([name]) => /^loan(word)?_\d+$/.test(name.replace(REVERSED, ""))))
