import type { Language } from "@kotori/domain"
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "@typesafe-ai/sdk"

/**
 * The judgments Jev makes about one sense of a word. Each is narrow and
 * independent (Jev answers them in parallel), and refers to fields of the state
 * built in `state.ts` by backticked path. Code combines the answers.
 */

export const FORMALITY_LEVELS = ["vulgar", "casual", "neutral", "polite", "formal"] as const
export const MEDIUM_LEVELS = ["spoken", "both", "written"] as const

// Jev reads a delicate subject as a stiff, written register: without this, everyday
// words such as 勃起 and 妊娠 came out as bookish as 鑑みる.
const SUBJECT_NOT_REGISTER =
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

const connotation: ChoiceQuestion = {
  type: "choice",
  instructions: "Beyond its literal meaning in `meaning`, what feeling does the Japanese word `word` carry?",
  criteria: {
    neutral: "Neutral: no particular positive or negative feeling",
    positive: "Positive, warm or complimentary",
    negative: "Negative, critical or pejorative"
  }
}

// Jev reads literally: without the conjugation caveat it judges the bare dictionary
// form ("食べる？" to a boss), so ordinary verbs come out as rude.
const rudeToSuperiors: NoulQuestion = {
  type: "noul",
  instructions:
    "Someone talking to their boss or a customer uses the Japanese word `word` (meaning `meaning`), conjugated politely with です/ます wherever that applies. Is choosing this word still rude, crude or overly familiar?",
  criteria: {
    true: "Yes: the word itself is rough, slangy or overly familiar, so it sounds rude even with です/ます, e.g. 食う, めっちゃ, うまい (for 'tasty'), ご苦労様 (said to a superior)",
    false:
      "No: with です/ます it is acceptable with a boss or customer, even if a more honorific word exists, e.g. 行く → 行きます, 見る → 見ます, 大きい → 大きいです"
  }
}

// Asked whether a word "sounds stiff between friends", Jev answers whether the subject
// is awkward to raise. Asking what kind of vocabulary it is keeps keigo and bookish
// words stiff without catching everyday words for delicate things.
const stiffWithFriends: NoulQuestion = {
  type: "noul",
  instructions: `Is the Japanese word \`word\` (meaning \`meaning\`) keigo, or found mostly in formal, official, academic or clinical language, rather than in the everyday speech of ordinary people? Judge the Japanese word, not the English gloss. ${SUBJECT_NOT_REGISTER}`,
  criteria: {
    true: "Yes: keigo, or formal, official, academic or clinical language, e.g. 召し上がる, ございます, 鑑みる, 誠に, 性交",
    false: "No: everyday speech, e.g. 行く, 時間, 妊娠, セックス"
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
  rudeToSuperiors,
  stiffWithFriends,
  slang
}

export type SenseQuestions = typeof senseQuestions

// English words, for Japanese speakers learning them. The same judgments without keigo,
// which English doesn't have; the meaning Jev reads is the Japanese gloss, so each question
// says which language is which.

const englishFormality: ScoreQuestion = {
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

const englishMedium: ScoreQuestion = {
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

const englishGender: ChoiceQuestion = {
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

const englishAge: ChoiceQuestion = {
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

const englishCurrency: ChoiceQuestion = {
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

const englishConnotation: ChoiceQuestion = {
  type: "choice",
  instructions:
    "Beyond its literal meaning in `meaning` (written in Japanese), what feeling does the English word `word` carry?",
  criteria: connotation.criteria
}

const englishRudeToSuperiors: NoulQuestion = {
  type: "noul",
  instructions:
    "Someone talking to their boss or a customer uses the English word `word` (meaning `meaning`, written in Japanese). Is choosing this word rude, crude or overly familiar?",
  criteria: {
    true: "Yes: the word itself is rough, slangy or overly familiar, so it sounds rude or too casual with a boss or customer, e.g. yeah, gonna, dude, crap",
    false: "No: it is acceptable with a boss or customer, even if a more formal word exists, e.g. yes, get, big, thanks"
  }
}

const englishStiffWithFriends: NoulQuestion = {
  type: "noul",
  instructions: `Is the English word \`word\` (meaning \`meaning\`, written in Japanese) found mostly in formal, official, academic or clinical language, rather than in the everyday speech of ordinary people? Judge the English word, not the Japanese gloss. ${SUBJECT_NOT_REGISTER}`,
  criteria: {
    true: "Yes: formal, official, academic or clinical language, e.g. commence, endeavor, hereby, utilize, sexual intercourse",
    false: "No: everyday speech, e.g. start, try, use, pregnant, sex"
  }
}

const englishSlang: NoulQuestion = {
  type: "noul",
  instructions:
    "Is the English word `word`, with the meaning in `meaning` (written in Japanese), slang (including youth or internet slang)?",
  criteria: {
    true: "Yes: it is slang, e.g. lit, sus, bucks (for dollars), dope (for great)",
    false: "No: it is standard vocabulary, even if casual, e.g. kid, guy, awesome, pretty (for quite)"
  }
}

export const englishSenseQuestions = {
  formality: englishFormality,
  medium: englishMedium,
  gender: englishGender,
  age: englishAge,
  currency: englishCurrency,
  connotation: englishConnotation,
  rudeToSuperiors: englishRudeToSuperiors,
  stiffWithFriends: englishStiffWithFriends,
  slang: englishSlang
}

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

/** English has no keigo, so an English word's similar words can't differ by it. */
const { respectful: _, humble: __, ...ENGLISH_DIFFERENCES } = DIFFERENCES

/** Two questions per candidate: is it a near-synonym, and how does it differ. */
export const candidateQuestions = (index: number, language: Language = "ja") => ({
  [`similar_${index}`]: {
    type: "noul",
    instructions: `Can \`candidates[${index}].word\` express the same meaning as \`word\` (as described in \`meaning\`) in at least some sentences?`,
    criteria: {
      true: "Yes: it is a near-synonym that could replace it in some sentences",
      false: "No: it is related, but means something different"
    }
  } satisfies NoulQuestion,
  [`difference_${index}`]: {
    type: "choice",
    instructions: `Compared with \`word\`, what is the main difference when a native speaker chooses \`candidates[${index}].word\` instead?`,
    criteria: language === "ja" ? DIFFERENCES : ENGLISH_DIFFERENCES
  } satisfies ChoiceQuestion
})
