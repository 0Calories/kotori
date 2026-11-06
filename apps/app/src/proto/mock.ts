/**
 * PROTOTYPE DATA. Hand-written entries in the proposed model (`model.ts`). The Japanese words
 * carry their real JMDict ids and tags; the English ones follow the English dictionary's numbering.
 * Every sentence, pattern and pitfall is written as the pipeline would store it, with its source.
 */
import type { Entry, Example, Formality, Label, LoanLink, Pattern, Pitfall, Source } from "./model.ts"

const ex = (
  id: number,
  furigana: string,
  en: string,
  formality: Formality,
  source: Source = "kotori",
  audio = true
): Example => ({
  id,
  ja: furigana.replace(/\{([^|]+)\|[^}]+\}/g, "$1"),
  furigana,
  en,
  formality,
  source,
  audio
})

/** An English sentence with its Japanese translation: no furigana on the learner's own language. */
const exEn = (id: number, en: string, ja: string, formality: Formality, source: Source = "kotori"): Example => ({
  id,
  ja,
  furigana: ja,
  en,
  formality,
  source,
  audio: source === "kotori"
})

const jm = (code: Label["code"]): Label => ({ code, source: "jmdict" })
const wk = (code: Label["code"]): Label => ({ code, source: "enwiktionary" })
const kt = (code: Label["code"]): Label => ({ code, source: "kotori" })

const pat = (text: string, source: Source = "jmdict", about?: number): Pattern => ({
  text,
  source,
  ...(about === undefined ? {} : { about })
})

const pit = (
  id: number,
  kind: Pitfall["kind"],
  text: string,
  sense: number | null,
  about?: number,
  source: Source = "kotori"
): Pitfall => ({ id, kind, text, sense, ...(about === undefined ? {} : { about }), source })

const NONE = { everyday: false, spokenCount: null, familiarity: null } as const

// ---------------------------------------------------------------------------------------------
// Japanese words, for English speakers learning Japanese
// ---------------------------------------------------------------------------------------------

export const TABERU = 1358280
export const KUU = 1269130
export const MESHIAGARU = 1594790
export const ITADAKU = 1587290
export const RYOUKAI = 1553760
export const SHOUCHI = 1349270
export const GOKUROUSAMA = 1270610
export const OTSUKARESAMA = 2134110
export const ATASHI = 1586330
export const KANGAMIRU = 1573640
export const MANSHON = 1130470
export const OOKINI = 2135690
export const KEKKOU = 1256000
export const TAIYAKI = 1000000
export const TEMEE = 1007200
export const DAKU = 1584170
export const DAKISHIMERU = 1584180

export const EAT = 100000001
export const MANSION = 100000010
export const NAIVE = 100000011
export const HOW_DO_YOU_DO = 100000012
export const ADVICE = 100000013
export const LIFT = 100000014
export const ELEVATOR = 100000015
export const YEP = 100000016
export const GONNA = 100000017
export const PIECE_OF_CAKE = 100000018
export const FUCK = 100000019
export const DIME_A_DOZEN = 100000020
export const HITHER = 100000021
export const SORRY = 100000022

/** The katakana ↔ English pairs, each one fact read from both entries. */
const MANSION_LOAN: LoanLink = {
  katakana: "マンション",
  katakanaEntryId: MANSHON,
  english: "mansion",
  englishEntryId: MANSION,
  meaning: "divergent",
  source: "kotori"
}
const NAIVE_LOAN: LoanLink = {
  katakana: "ナイーブ",
  katakanaEntryId: null,
  english: "naive",
  englishEntryId: NAIVE,
  meaning: "divergent",
  source: "kotori"
}
const ADVICE_LOAN: LoanLink = {
  katakana: "アドバイス",
  katakanaEntryId: null,
  english: "advice",
  englishEntryId: ADVICE,
  meaning: "same",
  source: "kotori"
}
const LIFT_LOAN: LoanLink = {
  katakana: "リフト",
  katakanaEntryId: null,
  english: "lift",
  englishEntryId: LIFT,
  meaning: "divergent",
  source: "kotori"
}
const ELEVATOR_LOAN: LoanLink = {
  katakana: "エレベーター",
  katakanaEntryId: null,
  english: "elevator",
  englishEntryId: ELEVATOR,
  meaning: "same",
  source: "kotori"
}

const taberu: Entry = {
  id: TABERU,
  language: "ja",
  headword: "食べる",
  reading: "たべる",
  romaji: "taberu",
  forms: [
    { text: "食べる", kind: "kanji", tags: [] },
    { text: "喰べる", kind: "kanji", tags: ["rK"] },
    { text: "たべる", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to eat"],
      pos: ["ichidan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        ex(1, "{今日|きょう}は{何|なに}を{食|た}べる？", "What are we eating today?", "casual"),
        ex(2, "{朝|あさ}ご{飯|はん}はもう{食|た}べました。", "I've already had breakfast.", "polite")
      ],
      similar: [KUU, MESHIAGARU, ITADAKU],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["to live on (e.g. a salary)", "to subsist on"],
      pos: ["ichidan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [pat("usu. as 〜で食べていく", "kotori")],
      examples: [
        ex(
          3,
          "{絵|え}だけで{食|た}べていくのは{難|むずか}しい。",
          "It's hard to make a living from painting alone.",
          "neutral",
          "tatoeba",
          false
        )
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests: "The quiet happy path: common, no labels, no pitfalls. The page should feel complete, not empty."
}

const kuu: Entry = {
  id: KUU,
  language: "ja",
  headword: "食う",
  reading: "くう",
  romaji: "kuu",
  forms: [
    { text: "食う", kind: "kanji", tags: [] },
    { text: "喰う", kind: "kanji", tags: [] },
    { text: "くう", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to eat"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [jm("col"), jm("male")],
      patterns: [],
      examples: [
        ex(
          10,
          "{腹|はら}{減|へ}った。{何|なん}か{食|く}おうぜ。",
          "I'm starving. Let's grab something to eat.",
          "casual"
        ),
        ex(11, "{昨日|きのう}、{焼|や}き{肉|にく}{食|く}った？", "Did you have yakiniku yesterday?", "casual")
      ],
      similar: [TABERU],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["to bite", "to sting (of insects)"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [pat("usu. in the passive: 蚊に食われる", "kotori")],
      examples: [ex(12, "{蚊|か}に{食|く}われた。", "I got bitten by a mosquito.", "casual")],
      similar: [],
      antonyms: []
    },
    {
      index: 2,
      glosses: ["to use up (time, money)", "to consume"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [pat("as 時間を食う, 電気を食う", "kotori")],
      examples: [
        ex(13, "この{作業|さぎょう}は{時間|じかん}を{食|く}うな。", "This job really eats up time.", "neutral")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      100,
      "rude_upward",
      "Rough and masculine even with です・ます. With a boss, a client or anyone you don't know well, say 食べる.",
      0,
      TABERU
    )
  ],
  audio: true,
  tests:
    "Labels do the heavy lifting (casual, masculine). One pitfall, scoped to sense 1. Senses 2 and 3 are unmarked and carry patterns."
}

const daku: Entry = {
  id: DAKU,
  language: "ja",
  headword: "抱く",
  reading: "だく",
  romaji: "daku",
  forms: [
    { text: "抱く", kind: "kanji", tags: [] },
    { text: "だく", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to hold in one's arms (e.g. a baby)", "to embrace", "to hug"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        ex(220, "{赤|あか}ちゃんを{抱|だ}いてあやした。", "I held the baby and soothed her.", "neutral"),
        ex(221, "{猫|ねこ}を{抱|だ}いたまま{寝|ね}てしまった。", "I fell asleep holding the cat.", "casual")
      ],
      similar: [DAKISHIMERU],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["to sleep with", "to have sex with"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [pat("with a person as the object: 彼女を抱く", "kotori")],
      examples: [],
      similar: [],
      antonyms: []
    },
    {
      index: 2,
      glosses: ["to sit on (eggs)", "to brood"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      230,
      "confusable",
      "Said of an adult, 抱く is usually heard as sense 2. For a hug, say 抱きしめる or ハグする; 抱く is safe for babies, pets and objects.",
      0,
      DAKISHIMERU
    )
  ],
  audio: true,
  tests:
    "An innocent word with one loaded sense. The pitfall is scoped to sense 1, where the learner would reach for it, not to the word."
}

const dakishimeru: Entry = {
  id: DAKISHIMERU,
  language: "ja",
  headword: "抱きしめる",
  reading: "だきしめる",
  romaji: "dakishimeru",
  forms: [
    { text: "抱きしめる", kind: "kanji", tags: [] },
    { text: "抱き締める", kind: "kanji", tags: [] },
    { text: "だきしめる", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: false, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to hug someone close", "to hold tightly", "to embrace closely"],
      pos: ["ichidan verb", "transitive"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        ex(
          240,
          "{久|ひさ}しぶりに{会|あ}った{母|はは}を{抱|だ}きしめた。",
          "I hugged my mother, whom I hadn't seen in ages.",
          "neutral"
        )
      ],
      similar: [DAKU],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests: "The safe word 抱く's pitfall points at."
}

const meshiagaru: Entry = {
  id: MESHIAGARU,
  language: "ja",
  headword: "召し上がる",
  reading: "めしあがる",
  romaji: "meshiagaru",
  forms: [
    { text: "召し上がる", kind: "kanji", tags: [] },
    { text: "召しあがる", kind: "kanji", tags: [] },
    { text: "めしあがる", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to eat", "to drink"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [jm("hon")],
      patterns: [pat("お召し上がりください on signs and menus", "kotori")],
      examples: [
        ex(20, "どうぞ、{召|め}し{上|あ}がってください。", "Please, go ahead and eat.", "polite"),
        ex(21, "{温|あたた}かいうちにお{召|め}し{上|あ}がりください。", "Please enjoy it while it's warm.", "formal")
      ],
      similar: [TABERU, ITADAKU],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      110,
      "keigo_direction",
      "Respectful language is about someone else eating. For your own eating in a polite setting, say いただく.",
      null,
      ITADAKU
    )
  ],
  audio: true,
  tests:
    "Keigo: the label says respectful, the pitfall says which direction. Checks that the two don't repeat each other."
}

const itadaku: Entry = {
  id: ITADAKU,
  language: "ja",
  headword: "いただく",
  reading: "いただく",
  romaji: "itadaku",
  forms: [
    { text: "頂く", kind: "kanji", tags: [] },
    { text: "戴く", kind: "kanji", tags: ["rK"] },
    { text: "いただく", kind: "kana", tags: [] }
  ],
  usuallyKana: true,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to receive", "to get", "to accept"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [jm("hum")],
      patterns: [],
      examples: [
        ex(30, "{先生|せんせい}から{本|ほん}をいただきました。", "I received a book from my teacher.", "polite")
      ],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["to eat", "to drink"],
      pos: ["godan verb", "transitive"],
      fields: [],
      labels: [jm("hum"), jm("pol")],
      patterns: [pat("いただきます before a meal")],
      examples: [ex(31, "{遠慮|えんりょ}なくいただきます。", "I'll gladly have some, thank you.", "polite")],
      similar: [TABERU, MESHIAGARU],
      antonyms: []
    },
    {
      index: 2,
      glosses: ["to have someone do something (for you)"],
      pos: ["auxiliary verb"],
      fields: [],
      labels: [jm("hum"), jm("pol")],
      patterns: [pat("follows a verb in the -te form: 〜ていただく")],
      examples: [
        ex(32, "{資料|しりょう}を{送|おく}っていただけますか。", "Could you send me the documents?", "polite")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "Multi-sense keigo word with patterns from JMDict's own notes. No pitfall needed: the labels and patterns say it."
}

const ryoukai: Entry = {
  id: RYOUKAI,
  language: "ja",
  headword: "了解",
  reading: "りょうかい",
  romaji: "ryōkai",
  forms: [
    { text: "了解", kind: "kanji", tags: [] },
    { text: "諒解", kind: "kanji", tags: ["rK"] },
    { text: "りょうかい", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["understanding", "comprehension", "consent", "agreement"],
      pos: ["noun", "suru verb"],
      fields: [],
      labels: [],
      patterns: [pat("了解です／了解しました as an acknowledgement", "kotori")],
      examples: [
        ex(40, "{了解|りょうかい}！{後|あと}で{行|い}くね。", "Got it! I'll come by later.", "casual"),
        ex(
          41,
          "{明日|あした}の{予定|よてい}、{了解|りょうかい}しました。",
          "Understood about tomorrow's schedule.",
          "polite"
        )
      ],
      similar: [SHOUCHI],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["roger", "copy (radio)"],
      pos: ["interjection"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      120,
      "rude_upward",
      "Looks neutral, but many people read 了解しました as what a superior says to a subordinate. To a boss or a client, 承知しました or かしこまりました is the safe acknowledgement.",
      0,
      SHOUCHI
    )
  ],
  audio: true,
  tests:
    "The word JMDict is silent about. No labels, so the pitfall is the only warning on the page. The key test for the pitfall concept."
}

const shouchi: Entry = {
  id: SHOUCHI,
  language: "ja",
  headword: "承知",
  reading: "しょうち",
  romaji: "shōchi",
  forms: [
    { text: "承知", kind: "kanji", tags: [] },
    { text: "しょうち", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["acknowledgement", "awareness", "consent"],
      pos: ["noun", "suru verb"],
      fields: [],
      labels: [],
      patterns: [pat("承知しました／承知いたしました to a superior or a customer", "kotori")],
      examples: [
        ex(
          50,
          "{承知|しょうち}いたしました。すぐに{手配|てはい}します。",
          "Certainly. I'll arrange it right away.",
          "formal"
        )
      ],
      similar: [RYOUKAI],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["forgiving", "letting off"],
      pos: ["noun", "suru verb"],
      fields: [],
      labels: [],
      patterns: [pat("usu. in the negative: 承知しない")],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    'The target of 了解\'s pitfall. Also a JMDict `s_inf` pattern ("usu. in the negative") shown as a first-class pattern.'
}

const gokurousama: Entry = {
  id: GOKUROUSAMA,
  language: "ja",
  headword: "ご苦労様",
  reading: "ごくろうさま",
  romaji: "gokurōsama",
  forms: [
    { text: "ご苦労様", kind: "kanji", tags: [] },
    { text: "御苦労様", kind: "kanji", tags: ["rK"] },
    { text: "ごくろうさま", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["thank you for your hard work", "I appreciate your efforts"],
      pos: ["expression"],
      fields: [],
      labels: [jm("pol")],
      patterns: [
        pat("usu. to one's subordinate"),
        pat(
          "Said downward: a manager to staff, a customer to a courier. Upward it sounds condescending; to a colleague or a superior, say お疲れ様です.",
          "kotori",
          OTSUKARESAMA
        )
      ],
      examples: [
        ex(60, "{配達|はいたつ}、ご{苦労|くろう}{様|さま}でした。", "Thanks for the delivery.", "polite"),
        ex(
          61,
          "{遅|おそ}くまでご{苦労|くろう}{様|さま}。もう{帰|かえ}っていいよ。",
          "Thanks for staying late. You can head home now.",
          "casual"
        )
      ],
      similar: [OTSUKARESAMA],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "JMDict's own note and Kotori's added context sit together as two notes, Kotori's marked. No red warning: the dictionary already flagged it."
}

const otsukaresama: Entry = {
  id: OTSUKARESAMA,
  language: "ja",
  headword: "お疲れ様",
  reading: "おつかれさま",
  romaji: "otsukaresama",
  forms: [
    { text: "お疲れ様", kind: "kanji", tags: [] },
    { text: "お疲れさま", kind: "kanji", tags: [] },
    { text: "おつかれさま", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["thank you for your hard work", "good work"],
      pos: ["expression"],
      fields: [],
      labels: [],
      patterns: [pat("お疲れ様です as a greeting at work; お疲れ様でした when someone leaves", "kotori")],
      examples: [
        ex(
          70,
          "お{疲|つか}れ{様|さま}です。{今|いま}お{時間|じかん}いいですか？",
          "Hi. Do you have a moment?",
          "polite"
        ),
        ex(
          71,
          "お{先|さき}に{失礼|しつれい}します。お{疲|つか}れ{様|さま}でした。",
          "I'm heading off. See you tomorrow.",
          "polite"
        )
      ],
      similar: [GOKUROUSAMA],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["see you", "goodbye (between colleagues)"],
      pos: ["expression"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      140,
      "set_phrase",
      "It isn't really about being tired: it's the all-purpose workplace greeting, hello and goodbye. Translating it literally sounds odd.",
      null
    )
  ],
  audio: true,
  tests:
    "A pitfall that is cultural, not about rudeness. No label applies. Tests whether a pattern plus a pitfall reads as two things or as one."
}

const atashi: Entry = {
  id: ATASHI,
  language: "ja",
  headword: "あたし",
  reading: "あたし",
  romaji: "atashi",
  forms: [
    { text: "私", kind: "kanji", tags: [] },
    { text: "あたし", kind: "kana", tags: [] }
  ],
  usuallyKana: true,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["I", "me"],
      pos: ["pronoun"],
      fields: [],
      labels: [jm("fem")],
      patterns: [pat("あたくし is more polite")],
      examples: [
        ex(80, "あたしも{行|い}きたい！", "I want to come too!", "casual"),
        ex(81, "あたし、そんなこと{言|い}ってないよ。", "I never said that.", "casual")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      150,
      "gendered_speech",
      "Feminine and casual. From a man it sounds like a put-on. In anything formal, 私 (わたし／わたくし) for everyone.",
      null
    )
  ],
  audio: true,
  tests:
    'Gendered speech. The label alone ("feminine") doesn\'t tell a learner what happens if they use it anyway; the pitfall does. Also a `uk` word: kana shown as the headword, kanji in forms.'
}

const kangamiru: Entry = {
  id: KANGAMIRU,
  language: "ja",
  headword: "鑑みる",
  reading: "かんがみる",
  romaji: "kangamiru",
  forms: [
    { text: "鑑みる", kind: "kanji", tags: [] },
    { text: "鑒みる", kind: "kanji", tags: ["rK"] },
    { text: "かんがみる", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: false,
  dictionary: "jmdict",
  evidence: NONE,
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["to take into account", "to consider", "to bear in mind"],
      pos: ["ichidan verb", "transitive"],
      fields: [],
      labels: [kt("form")],
      patterns: [pat("almost always 〜に鑑みて／〜に鑑み", "kotori")],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: false,
  tests:
    "JMDict's gap: a stiff written word with no dictionary tag. The `form` label comes from Kotori's fill, marked ✦ with an explanation on tap. Uncommon, so no examples yet."
}

const manshon: Entry = {
  id: MANSHON,
  language: "ja",
  headword: "マンション",
  reading: "マンション",
  romaji: "manshon",
  forms: [{ text: "マンション", kind: "kana", tags: [] }],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: MANSION_LOAN,
  senses: [
    {
      index: 0,
      glosses: ["condominium (usu. mid- or high-rise)", "apartment building", "block of flats"],
      pos: ["noun"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        ex(
          90,
          "{駅前|えきまえ}の{新|あたら}しいマンションに{引|ひ}っ{越|こ}した。",
          "I moved into the new apartment building by the station.",
          "neutral"
        ),
        ex(91, "マンションの{三階|さんがい}に{住|す}んでいます。", "I live on the third floor of a condo.", "polite")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "Loan origin on the Japanese side: a one-line \"from English mansion, but not a mansion\" from JMDict's lsource and Kotori's verdict. Interesting for an English native; essential only on the English entry."
}

const ookini: Entry = {
  id: OOKINI,
  language: "ja",
  headword: "おおきに",
  reading: "おおきに",
  romaji: "ōkini",
  forms: [
    { text: "大きに", kind: "kanji", tags: [] },
    { text: "おおきに", kind: "kana", tags: [] }
  ],
  usuallyKana: true,
  common: false,
  dictionary: "jmdict",
  evidence: NONE,
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["thank you", "thanks"],
      pos: ["interjection"],
      fields: [],
      labels: [jm("ksb")],
      patterns: [],
      examples: [
        ex(95, "おおきに、また{来|き}てや。", "Thanks, come again.", "casual"),
        ex(96, "{手伝|てつど}うてくれて、ほんまおおきに。", "Thanks so much for helping out.", "casual")
      ],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["very much", "greatly"],
      pos: ["adverb"],
      fields: [],
      labels: [jm("dated")],
      patterns: [],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "A regional variety label (Kansai) and a sense-level `dated` label on sense 2 that differs from the word's. Examples written in the dialect."
}

const kekkou: Entry = {
  id: KEKKOU,
  language: "ja",
  headword: "結構",
  reading: "けっこう",
  romaji: "kekkō",
  forms: [
    { text: "結構", kind: "kanji", tags: [] },
    { text: "けっこう", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "jmdict",
  evidence: { everyday: true, spokenCount: null, familiarity: null },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["splendid", "nice", "wonderful", "delightful"],
      pos: ["na-adjective"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [ex(200, "{結構|けっこう}なお{点前|てまえ}でした。", "That was a beautifully made tea.", "formal")],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["sufficient", "fine (as in 'that's fine')", "no thank you"],
      pos: ["na-adjective"],
      fields: [],
      labels: [],
      patterns: [pat("結構です for both 'that's fine' and 'no, thank you'")],
      examples: [
        ex(
          201,
          "「お{代|か}わりは？」「いえ、{結構|けっこう}です。」",
          '"Another helping?" "No, I\'m fine, thanks."',
          "polite"
        ),
        ex(202, "それで{結構|けっこう}です。", "That will do fine.", "polite")
      ],
      similar: [],
      antonyms: []
    },
    {
      index: 2,
      glosses: ["quite", "reasonably", "fairly"],
      pos: ["adverb"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        ex(203, "この{店|みせ}、{結構|けっこう}おいしいね。", "This place is pretty good, actually.", "casual")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      160,
      "set_phrase",
      "結構です is a polite yes and a polite no. When you're declining, make it unmistakable: いえ、結構です, or 大丈夫です with a small wave.",
      1
    )
  ],
  audio: true,
  tests:
    "Three senses, three parts of speech, one ambiguity that trips everyone. The pitfall sits on sense 2 only. Tests sense-scoped placement."
}

const taiyaki: Entry = {
  id: TAIYAKI,
  language: "ja",
  headword: "鯛焼き",
  reading: "たいやき",
  romaji: "taiyaki",
  forms: [
    { text: "鯛焼き", kind: "kanji", tags: [] },
    { text: "たい焼き", kind: "kanji", tags: [] },
    { text: "たいやき", kind: "kana", tags: [] }
  ],
  usuallyKana: false,
  common: false,
  dictionary: "jmdict",
  evidence: NONE,
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["taiyaki", "fish-shaped pancake filled with bean jam"],
      pos: ["noun"],
      fields: ["food"],
      labels: [],
      patterns: [],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: false,
  tests:
    "Dictionary-only. Nothing from Kotori, no Tatoeba sentence. The page must still look finished and offer to enrich."
}

const temee: Entry = {
  id: TEMEE,
  language: "ja",
  headword: "てめえ",
  reading: "てめえ",
  romaji: "temee",
  forms: [
    { text: "手前", kind: "kanji", tags: ["rK"] },
    { text: "てめえ", kind: "kana", tags: [] },
    { text: "てめぇ", kind: "kana", tags: [] }
  ],
  usuallyKana: true,
  common: false,
  dictionary: "jmdict",
  evidence: NONE,
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["you (hostile)", "you bastard"],
      pos: ["pronoun"],
      fields: [],
      labels: [jm("derog"), jm("male")],
      patterns: [],
      examples: [ex(210, "てめえ、{何|なに}{見|み}てんだよ。", "What the hell are you looking at?", "vulgar")],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests: "Obviously rude. The labels say it, in the avoid colour; there is deliberately no pitfall."
}

// ---------------------------------------------------------------------------------------------
// English words, for Japanese speakers learning English
// ---------------------------------------------------------------------------------------------

const eat: Entry = {
  id: EAT,
  language: "en",
  headword: "eat",
  reading: "/iːt/",
  romaji: "",
  forms: [
    { text: "eat", kind: "spelling", tags: [] },
    { text: "ate", kind: "inflection", tags: ["past"] },
    { text: "eaten", kind: "inflection", tags: ["past participle"] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 61_000, familiarity: 5 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["～を食べる"],
      pos: ["動詞", "他動詞"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        exEn(300, "She ate lunch at her desk again.", "彼女はまたデスクで昼食を食べた。", "neutral"),
        exEn(301, "Have you eaten yet?", "もうご飯食べた？", "casual")
      ],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["食事をする"],
      pos: ["動詞", "自動詞"],
      fields: [],
      labels: [],
      patterns: [pat("eat out で「外食する」", "kotori")],
      examples: [exEn(302, "Let's eat out tonight.", "今夜は外で食べよう。", "casual")],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests: "English happy path. A common-word chip from subtitle evidence. One collocation as a pattern."
}

const mansion: Entry = {
  id: MANSION,
  language: "en",
  headword: "mansion",
  reading: "/ˈmænʃən/",
  romaji: "",
  forms: [
    { text: "mansion", kind: "spelling", tags: [] },
    { text: "mansions", kind: "inflection", tags: ["plural"] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: false, spokenCount: 2_300, familiarity: 4 },
  loan: MANSION_LOAN,
  senses: [
    {
      index: 0,
      glosses: ["大邸宅", "豪邸"],
      pos: ["名詞"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        exEn(310, "They bought a mansion with twelve bedrooms.", "彼らは寝室が12もある豪邸を買った。", "neutral"),
        exEn(311, "It's not a mansion, but it's home.", "豪邸じゃないけど、我が家だよ。", "casual")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      400,
      "false_friend",
      "日本語の「マンション」は集合住宅ですが、英語の mansion は大富豪の「豪邸」です。自分の住まいを mansion と言うと驚かれます。普通の集合住宅は apartment（米）／flat（英）と言います。",
      null,
      MANSHON
    )
  ],
  audio: true,
  tests: "The flagship false friend. The pitfall is the headline for a Japanese native. Links to マンション."
}

const naive: Entry = {
  id: NAIVE,
  language: "en",
  headword: "naive",
  reading: "/naɪˈiːv/",
  romaji: "",
  forms: [
    { text: "naive", kind: "spelling", tags: [] },
    { text: "naïve", kind: "spelling", tags: [] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: false, spokenCount: 1_900, familiarity: 4 },
  loan: NAIVE_LOAN,
  senses: [
    {
      index: 0,
      glosses: ["世間知らずの", "だまされやすい", "考えが甘い"],
      pos: ["形容詞"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [
        exEn(320, "I was naive to think he'd pay me back.", "彼が返してくれると思うなんて、甘かった。", "neutral"),
        exEn(321, "Don't be so naive. Read the contract.", "そんなに甘く見ないで。契約書を読んで。", "casual")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      410,
      "false_friend",
      "「ナイーブ」は日本語では「繊細」「純粋」とよい意味にも使いますが、英語の naive はほぼ否定的で「世間知らず」「考えが甘い」という評価です。繊細な人は sensitive と言います。",
      null
    )
  ],
  audio: true,
  tests: "A false friend where the drift is in connotation, not referent. No katakana entry to link to in the mock."
}

const howDoYouDo: Entry = {
  id: HOW_DO_YOU_DO,
  language: "en",
  headword: "how do you do",
  reading: "",
  romaji: "",
  forms: [{ text: "how do you do", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: false,
  dictionary: "enwiktionary",
  evidence: { everyday: false, spokenCount: null, familiarity: 2 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["はじめまして（改まった挨拶）"],
      pos: ["表現"],
      fields: [],
      labels: [wk("dated"), wk("form")],
      patterns: [],
      examples: [
        exEn(330, '"How do you do?" "How do you do."', "「はじめまして」「はじめまして」", "formal", "enwiktionary")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      420,
      "textbook_english",
      "教科書の定番ですが、今のネイティブはほとんど言いません。初対面なら Nice to meet you、くだけた場では Hi, I'm ... で十分です。",
      null
    )
  ],
  audio: false,
  tests:
    'Textbook English. Labels (dated, formal) and a pitfall both apply. Familiarity 2 gives the "rarely heard" chip.'
}

const advice: Entry = {
  id: ADVICE,
  language: "en",
  headword: "advice",
  reading: "/ədˈvaɪs/",
  romaji: "",
  forms: [{ text: "advice", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 9_800, familiarity: 5 },
  loan: ADVICE_LOAN,
  senses: [
    {
      index: 0,
      glosses: ["助言", "アドバイス"],
      pos: ["名詞"],
      fields: [],
      labels: [wk("uncountable")],
      patterns: [pat("a piece of advice／some advice。give／take／ask for advice", "kotori")],
      examples: [
        exEn(340, "Can I give you some advice?", "ひとつアドバイスしてもいい？", "casual"),
        exEn(341, "She took my advice and applied.", "彼女は私の助言を聞き入れて応募した。", "neutral")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "Grammar lives in the chip: tap `uncountable` for the an-advice warning. No pitfall. The katakana agrees, so a quiet same-meaning chip."
}

const lift: Entry = {
  id: LIFT,
  language: "en",
  headword: "lift",
  reading: "/lɪft/",
  romaji: "",
  forms: [
    { text: "lift", kind: "spelling", tags: [] },
    { text: "lifted", kind: "inflection", tags: ["past", "past participle"] },
    { text: "lifts", kind: "inflection", tags: ["plural", "third person"] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 6_400, familiarity: 5 },
  loan: LIFT_LOAN,
  senses: [
    {
      index: 0,
      glosses: ["～を持ち上げる"],
      pos: ["動詞", "他動詞"],
      fields: [],
      labels: [],
      patterns: [],
      examples: [exEn(350, "Help me lift this box.", "この箱を持ち上げるの手伝って。", "casual")],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["エレベーター"],
      pos: ["名詞"],
      fields: [],
      labels: [wk("en-GB")],
      patterns: [],
      examples: [exEn(351, "Take the lift to the fourth floor.", "エレベーターで4階へどうぞ。", "polite")],
      similar: [ELEVATOR],
      antonyms: []
    },
    {
      index: 2,
      glosses: ["車に乗せること"],
      pos: ["名詞"],
      fields: [],
      labels: [],
      patterns: [pat("give someone a lift「車で送る」", "kotori")],
      examples: [exEn(352, "Do you want a lift home?", "家まで送ろうか？", "casual")],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      440,
      "false_friend",
      "日本語の「リフト」はスキー場のリフトですが、英語の lift はイギリスでは「エレベーター」、どこでも「持ち上げる」「車で送ること」です。スキーのリフトは chairlift または ski lift と言います。",
      null
    )
  ],
  audio: true,
  tests:
    "A sense-level variety label (British) that differs from the word, a derived similar word (elevator), and a loan drift. Busy on purpose: does it hold together?"
}

const elevator: Entry = {
  id: ELEVATOR,
  language: "en",
  headword: "elevator",
  reading: "/ˈɛləveɪtɚ/",
  romaji: "",
  forms: [
    { text: "elevator", kind: "spelling", tags: [] },
    { text: "elevators", kind: "inflection", tags: ["plural"] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 4_100, familiarity: 5 },
  loan: ELEVATOR_LOAN,
  senses: [
    {
      index: 0,
      glosses: ["エレベーター"],
      pos: ["名詞"],
      fields: [],
      labels: [wk("en-US")],
      patterns: [],
      examples: [exEn(360, "The elevator's out of order again.", "エレベーターがまた故障してる。", "casual")],
      similar: [LIFT],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "The American counterpart of lift's British sense; the similar-word difference is derived from the two variety labels, not asked. Same-meaning loan chip."
}

const yep: Entry = {
  id: YEP,
  language: "en",
  headword: "yep",
  reading: "/jɛp/",
  romaji: "",
  forms: [{ text: "yep", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 14_000, familiarity: 5 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["うん", "そう"],
      pos: ["間投詞"],
      fields: [],
      labels: [wk("col")],
      patterns: [],
      examples: [
        exEn(370, '"You coming?" "Yep, two minutes."', "「来る？」「うん、2分で」", "casual"),
        exEn(371, "Yep, that's the one.", "そう、それそれ。", "casual")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "The casual label, in the caution colour, is the whole message. No pitfall: tap the chip if you want the sentence."
}

const gonna: Entry = {
  id: GONNA,
  language: "en",
  headword: "gonna",
  reading: "/ˈɡɔnə/",
  romaji: "",
  forms: [{ text: "gonna", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 108_000, familiarity: 5 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["～するつもり（going to の話し言葉）"],
      pos: ["助動詞"],
      fields: [],
      labels: [wk("col")],
      patterns: [pat("going to の発音どおりの綴り。書き言葉ではメールやチャット以外では going to と書く", "kotori")],
      examples: [
        exEn(380, "I'm gonna grab a coffee. Want one?", "コーヒー買ってくるけど、いる？", "casual"),
        exEn(381, "It's gonna rain. Bring a jacket.", "雨降りそうだよ。上着持ってって。", "casual")
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests: "Label plus a Kotori pattern, no pitfall. The most common word in the subtitle corpus."
}

const pieceOfCake: Entry = {
  id: PIECE_OF_CAKE,
  language: "en",
  headword: "piece of cake",
  reading: "",
  romaji: "",
  forms: [{ text: "piece of cake", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: null, familiarity: 5 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["朝飯前", "とても簡単なこと"],
      pos: ["名詞", "慣用句"],
      fields: [],
      labels: [wk("id"), wk("col")],
      patterns: [pat("It was a piece of cake. のように a を付けて使う", "kotori")],
      examples: [exEn(390, "The test? Piece of cake.", "テスト？楽勝だったよ。", "casual")],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests:
    "A phrase: no subtitle count, so familiarity carries the evidence. Idiom label in the quiet colour next to casual in the caution colour."
}

const fuck: Entry = {
  id: FUCK,
  language: "en",
  headword: "fuck",
  reading: "/fʌk/",
  romaji: "",
  forms: [
    { text: "fuck", kind: "spelling", tags: [] },
    { text: "fucked", kind: "inflection", tags: ["past", "past participle"] },
    { text: "fucking", kind: "inflection", tags: ["present participle"] }
  ],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 48_000, familiarity: 5 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["くそっ", "ちくしょう（強い罵り）"],
      pos: ["間投詞"],
      fields: [],
      labels: [wk("vulg")],
      patterns: [],
      examples: [exEn(500, "Fuck, I left my keys inside.", "くそっ、鍵を中に置いてきた。", "vulgar")],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["性交する"],
      pos: ["動詞"],
      fields: [],
      labels: [wk("vulg")],
      patterns: [],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: true,
  tests: "Vulgar, common, no pitfall. The avoid-coloured label and its explanation carry the warning."
}

const dimeADozen: Entry = {
  id: DIME_A_DOZEN,
  language: "en",
  headword: "a dime a dozen",
  reading: "",
  romaji: "",
  forms: [{ text: "a dime a dozen", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: false,
  dictionary: "enwiktionary",
  evidence: { everyday: false, spokenCount: null, familiarity: 3 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["ありふれた", "どこにでもある"],
      pos: ["形容詞", "慣用句"],
      fields: [],
      labels: [wk("id"), wk("en-US")],
      patterns: [],
      examples: [
        exEn(
          510,
          "Coffee shops like that are a dime a dozen around here.",
          "そういうカフェはこの辺にいくらでもある。",
          "neutral",
          "enwiktionary"
        )
      ],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: false,
  tests: "Mid familiarity: no usage chip either way. American, Wiktionary example only."
}

const hither: Entry = {
  id: HITHER,
  language: "en",
  headword: "hither",
  reading: "/ˈhɪðɚ/",
  romaji: "",
  forms: [{ text: "hither", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: false,
  dictionary: "enwiktionary",
  evidence: NONE,
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["こちらへ"],
      pos: ["副詞"],
      fields: [],
      labels: [wk("arch")],
      patterns: [pat("hither and thither「あちこちに」の形で残る", "kotori")],
      examples: [],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [],
  audio: false,
  tests:
    "Archaic, dictionary-only. The label is in the avoid colour, the usage chip says rarely heard, and tapping the label explains both."
}

const sorry: Entry = {
  id: SORRY,
  language: "en",
  headword: "sorry",
  reading: "/ˈsɑɹi/",
  romaji: "",
  forms: [{ text: "sorry", kind: "spelling", tags: [] }],
  usuallyKana: false,
  common: true,
  dictionary: "enwiktionary",
  evidence: { everyday: true, spokenCount: 95_000, familiarity: 5 },
  loan: null,
  senses: [
    {
      index: 0,
      glosses: ["ごめんなさい", "すみません（謝罪）"],
      pos: ["形容詞", "間投詞"],
      fields: [],
      labels: [],
      patterns: [pat("I'm sorry (that) ... ／ sorry for ～ing ／ sorry about ～", "kotori")],
      examples: [
        exEn(520, "Sorry I'm late. The train stopped.", "遅れてごめん。電車が止まっちゃって。", "casual"),
        exEn(521, "I'm sorry for your loss.", "お悔やみ申し上げます。", "polite")
      ],
      similar: [],
      antonyms: []
    },
    {
      index: 1,
      glosses: ["残念に思って", "気の毒で"],
      pos: ["形容詞"],
      fields: [],
      labels: [],
      patterns: [pat("I'm sorry to hear that. 「それは残念です」")],
      examples: [exEn(522, "I'm sorry to hear you've been unwell.", "体調を崩されていたとは、お気の毒に。", "polite")],
      similar: [],
      antonyms: []
    }
  ],
  pitfalls: [
    pit(
      470,
      "directness",
      "日本語の「すみません」の感覚で sorry を使うと謝りすぎに聞こえます。人を呼び止めるときは Excuse me、何かしてもらったときは Thank you です。sorry は本当に謝るときに。",
      0
    )
  ],
  audio: true,
  tests: "A directness pitfall: the mistake is overuse, not misuse. Two senses, pitfall on the first."
}

export const entries: ReadonlyArray<Entry> = [
  taberu,
  kuu,
  daku,
  dakishimeru,
  meshiagaru,
  itadaku,
  ryoukai,
  shouchi,
  gokurousama,
  otsukaresama,
  kekkou,
  atashi,
  manshon,
  ookini,
  kangamiru,
  temee,
  taiyaki,
  eat,
  mansion,
  naive,
  lift,
  elevator,
  advice,
  sorry,
  yep,
  gonna,
  howDoYouDo,
  pieceOfCake,
  dimeADozen,
  fuck,
  hither
]

export const byId = new Map(entries.map((entry) => [entry.id, entry]))
