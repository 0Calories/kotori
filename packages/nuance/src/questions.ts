import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk"

/**
 * The judgments Jev makes about each sense of a Japanese word, for learners of Japanese;
 * english.ts has their English counterparts. Each is narrow and independent (Jev answers them
 * in parallel), and refers by backticked name to the entry's state (`word`, `senses`) and to
 * its sense's scope in its own instructions (`meaning`, …), both built in `state.ts`;
 * request.ts puts them together. Code combines the answers.
 */

/**
 * Bumped whenever a question about Japanese words is added, removed or reworded, or what it sees changes, so
 * stored judgments say which questions produced them. Old rows stay valid; the API re-queues
 * outdated entries when they are viewed, and `kotori enrich nuance --outdated` backfills.
 * History: 1 — the launch set; 2 — registerShape added, stiffWithFriends dropped (derived in
 * interpret.ts), rudeToSuperiors told to ignore obviousness (docs/nuance-rework.md); 3 — one
 * request per entry, each question carrying its sense's scope in object-form instructions,
 * similar words kept at p >= 0.7, and the model moved to jev-1.14.0 (docs/nuance-on-english-entries.md).
 * English words have their own set and version (`ENGLISH_QUESTIONS_VERSION`).
 */
export const QUESTIONS_VERSION = 3

/**
 * Names a Choice asked again with its options in reverse order: jev-1.13 leans toward the option
 * listed first (model-jaggedness docs). The eval asks every Choice so; the katakana loan's is
 * always asked both ways, and read from the two together.
 */
export const REVERSED = "~reversed"

/** A Choice with its options in reverse order. */
export const reversedChoice = (question: ChoiceQuestion): ChoiceQuestion => ({
  ...question,
  criteria: Object.fromEntries(Object.entries(question.criteria).toReversed())
})

export const FORMALITY_LEVELS = ["vulgar", "casual", "neutral", "polite", "formal"] as const
export const MEDIUM_LEVELS = ["spoken", "both", "written"] as const

// Jev reads a delicate subject as a stiff, written register: without this, everyday
// words such as 勃起 and 妊娠 came out as bookish as 鑑みる.
export const SUBJECT_NOT_REGISTER =
  "Judge the word, not its subject: everyday words for bodily, medical or sexual things are everyday vocabulary."

const formality: ScoreQuestion = {
  type: "score",
  instructions:
    "How formal does the Japanese word `word` sound when a native speaker uses it with the meaning in `meaning`? Judge the Japanese word, not the English gloss.",
  criteria: [
    {
      what: "Vulgar or crude: rude, insulting or coarse; it would offend strangers or superiors",
      examples: ["てめえ", "くそ", "ぶっ殺す"]
    },
    {
      what: "Casual: relaxed or slangy, for friends and family; too familiar for a boss or a stranger",
      examples: ["めっちゃ", "やばい", "腹減った", "うん"]
    },
    {
      what: "Neutral: plain everyday wording that fits almost any situation",
      examples: ["歩く", "学校", "大きい", "時間"]
    },
    {
      what: "Polite: courteous wording suited to strangers, customers or superiors",
      examples: ["お手洗い", "ございます", "よろしい"]
    },
    {
      what: "Formal: keigo, business or ceremonial wording for speeches, letters and official settings",
      examples: ["召し上がる", "拝見する", "誠に", "ご逝去"]
    }
  ]
}

const medium: ScoreQuestion = {
  type: "score",
  instructions: `Where is the Japanese word \`word\`, with the meaning in \`meaning\`, typically used: in conversation or in writing? ${SUBJECT_NOT_REGISTER}`,
  criteria: [
    {
      what: "Mostly spoken: conversational words that look out of place in formal writing",
      examples: ["うん", "ちゃんと", "すごく", "やっぱり"]
    },
    {
      what: "Equally common in conversation and in writing, including everyday words for health, the body and sex",
      examples: ["歩く", "時間", "友達", "妊娠"]
    },
    {
      what: "Mostly written: literary, journalistic, academic, legal or technical prose; sounds stiff or bookish aloud",
      examples: ["鑑みる", "及び", "当該", "遺憾"]
    }
  ]
}

const keigo: ChoiceQuestion = {
  type: "choice",
  instructions: "Is the Japanese word `word`, with the meaning in `meaning`, a form of honorific language (keigo)?",
  criteria: {
    none: "Not keigo: an ordinary word with no built-in respect or humility",
    sonkeigo:
      "Respectful language (尊敬語) that elevates someone else's actions, e.g. 召し上がる, いらっしゃる, おっしゃる",
    kenjougo: "Humble language (謙譲語) that lowers the speaker's own actions, e.g. 申す, 伺う, いただく, 拝見する",
    teineigo: "Polite language (丁寧語) not tied to anyone's actions, e.g. ございます, お手洗い, です",
    bikago: "Beautified word (美化語): a word with お or ご added to sound refined, e.g. お茶, ご飯, お金"
  }
}

const gender: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Do Japanese speakers associate the word `word`, with the meaning in `meaning`, with a particular gender?",
  criteria: {
    neutral: "Used naturally by speakers of any gender",
    masculine: "Sounds typically masculine; mostly used by men or boys, e.g. 俺, 腹減った, 〜ぜ",
    feminine: "Sounds typically feminine; mostly used by women or girls, e.g. あたし, 〜かしら, 〜わよ"
  }
}

const age: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Is the Japanese word `word`, with the meaning in `meaning`, typical of a particular age group of speakers?",
  criteria: {
    any: "Used by people of all ages, including formal and business words that working adults of every age use, e.g. 恐縮, 拝見する",
    children: "Childish or baby talk, used by or to small children, e.g. わんわん, おてて",
    youth: "Youth or internet slang, used mostly by teenagers and young adults, e.g. マジ, エモい, ググる",
    older: "Mainly used by older people; sounds old-fashioned coming from someone young, e.g. ハイカラ, 銀幕"
  }
}

const currency: ChoiceQuestion = {
  type: "choice",
  instructions:
    "How current does the Japanese word `word`, with the meaning in `meaning`, feel in present-day Japanese?",
  criteria: {
    current: "In ordinary use today, including formal, written and business words, e.g. 恐縮, 拝見する, 申し上げる",
    trendy: "A recent coinage or buzzword",
    dated: "Understood, but sounds old-fashioned in today's speech and writing, e.g. ハイカラ, ナウい",
    archaic: "Archaic or obsolete: found in classical texts or historical settings, not modern use, e.g. 候, 〜けり"
  }
}

/** What feeling a word carries, in either language. */
export const CONNOTATIONS = {
  neutral: "Neutral: no particular positive or negative feeling",
  positive: "Positive, warm or complimentary",
  negative: "Negative, critical or pejorative"
}

const connotation: ChoiceQuestion = {
  type: "choice",
  instructions: "Beyond its literal meaning in `meaning`, what feeling does the Japanese word `word` carry?",
  criteria: CONNOTATIONS
}

// Jev reads literally: without the conjugation caveat it judges the bare dictionary
// form ("食べる？" to a boss), so ordinary verbs come out as rude. The judgment records
// the fact even when it is obvious; whether to show the caution is display policy.
const rudeToSuperiors: NoulQuestion = {
  type: "noul",
  instructions:
    "Someone talking to their boss or a customer uses the Japanese word `word` (meaning `meaning`), conjugated politely with です/ます wherever that applies. Is choosing this word still rude, crude or overly familiar? Answer yes even when that is obvious from the meaning (insults, vulgar words): record the fact, not whether it needs saying.",
  criteria: {
    true: "Yes: the word itself is rough, slangy or overly familiar, so it sounds rude even with です/ます, e.g. 食う, めっちゃ, うまい (for 'tasty'), ご苦労様 (said to a superior), 馬鹿, てめえ",
    false:
      "No: with です/ます it is acceptable with a boss or customer, even if a more honorific word exists, e.g. 行く → 行きます, 見る → 見ます, 大きい → 大きいです"
  }
}

// "Sounds stiff between friends" used to be its own question here; Jev kept judging
// whether the subject was awkward instead of the register, so the caution is now
// derived from the formality, medium and keigo judgments in interpret.ts.

/**
 * Whether the casual↔formal scale is the right model for the word at all. Words judged
 * "fixed" or "split" get a chip instead of a slider: a slider implies a choice of
 * setting that these words don't have.
 */
const registerShape: ChoiceQuestion = {
  type: "choice",
  instructions: `Does the Japanese word \`word\`, with the meaning in \`meaning\`, genuinely vary along a casual-to-formal scale, or is its register fixed or split? ${SUBJECT_NOT_REGISTER}`,
  criteria: {
    scaled:
      "Ordinary vocabulary whose politeness depends on how it is used; it fits somewhere on a casual-to-formal scale, e.g. 歩く, 時間, めっちゃ, お手洗い",
    fixed:
      "Its register is invariant and obvious from what it means: insults, crude words, and ceremonial or ritual wording that never leaves its setting, e.g. てめえ, ぶっ殺す, ご逝去",
    split:
      "It lives in two registers at once with little in between: clinical, technical or official in one world, crude or joking in everyday talk, e.g. 勃起, 浣腸"
  }
}

const slang: NoulQuestion = {
  type: "noul",
  instructions:
    "Is the Japanese word `word`, with the meaning in `meaning`, slang (including youth or internet slang)?",
  criteria: {
    true: "Yes: it is slang, e.g. マジ, エモい, ググる, ヤバい (for 'amazing')",
    false: "No: it is standard vocabulary, even if casual, e.g. すごく, ちょっと, 友達"
  }
}

export const senseQuestions = {
  formality,
  medium,
  keigo,
  gender,
  age,
  currency,
  connotation,
  registerShape,
  rudeToSuperiors,
  slang
}

export type SenseQuestions = typeof senseQuestions

/** Ways a similar word can differ from the word being looked up. */
export const DIFFERENCES = {
  more_casual: "It is more casual or rough",
  more_formal: "It is more formal or polite",
  respectful: "It is the respectful (尊敬語) way to say this about someone else's action",
  humble: "It is the humble (謙譲語) way to say this about one's own action",
  more_literary: "It is more literary or used mainly in writing",
  more_colloquial: "It is more colloquial or used mainly in speech",
  more_specific: "Its meaning is narrower or more specific",
  more_general: "Its meaning is broader or more general",
  different_feeling: "It carries a different emotional tone or feeling",
  different_usage: "It is used in different situations or word combinations"
} as const
