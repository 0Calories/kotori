import type { Language, PitfallKind } from "@kotori/contracts"
import type { WordToJudge } from "../judge/word.ts"
import { s, word } from "./goldenWords.ts"

/**
 * Words with a known answer for `kotori eval pitfalls` and `kotori eval drafts`, in both
 * directions: words a learner trips over, and words that need no pitfall because the page already
 * says it (a label, the dictionary's note) or there is nothing to say. The model doc's examples
 * are here: 了解, お疲れ様 and ご苦労様, 結構, 抱く (scoped to its hug sense), "How do you do", and
 * the false friends マンション and ナイーブ (whose English entries already carry the warning as a
 * dictionary note, so they need none; リフト is left out, as no clear answer exists).
 *
 * A word that needs one is scored by kind, and where it matters by sense and by a word the text
 * must mention (any of `mentions`, in the text or `about`, ignoring case); the text itself is
 * printed for a person to read. Expected answers are claims about language: `evidence` names a
 * source where one says so, and `judgement` marks those that rest on the author's judgement.
 */

export type PitfallExpectation =
  | { readonly none: true }
  | {
      readonly none?: undefined
      readonly kinds: ReadonlyArray<PitfallKind>
      /** The sense it must be scoped to, by position; unset when any scope will do. */
      readonly sense?: number
      readonly mentions?: ReadonlyArray<string>
    }

export interface GoldenPitfall {
  readonly language: Language
  readonly word: WordToJudge
  readonly expect: PitfallExpectation
  readonly evidence: string
  readonly judgement: boolean
  /** Also asked of the Lexicographer as an Ask Kotori query (the headword), scored the same way. */
  readonly draft?: true
}

/** An Ask Kotori query the dictionary lacks, for the Lexicographer only. */
export interface GoldenDraft {
  readonly language: Language
  readonly query: string
  readonly expect: PitfallExpectation
  readonly evidence: string
  readonly judgement: boolean
}

const NONE = { none: true } as const

const needs = (
  kinds: ReadonlyArray<PitfallKind>,
  options: { readonly sense?: number; readonly mentions?: ReadonlyArray<string> } = {}
): PitfallExpectation => ({ kinds, ...options })

const ja = (
  w: WordToJudge,
  expect: PitfallExpectation,
  evidence: string,
  judgement: boolean,
  draft?: true
): GoldenPitfall => ({ language: "ja", word: w, expect, evidence, judgement, ...(draft ? { draft } : {}) })

const en = (
  w: WordToJudge,
  expect: PitfallExpectation,
  evidence: string,
  judgement: boolean,
  draft?: true
): GoldenPitfall => ({ language: "en", word: w, expect, evidence, judgement, ...(draft ? { draft } : {}) })

/** A katakana loan as the English entry shows it once the loan pass has judged it. */
const drifted = (katakana: string, glosses: ReadonlyArray<string>) => ({
  word: katakana,
  meaning: "divergent" as const,
  glosses
})

export const GOLDEN_PITFALLS: ReadonlyArray<GoldenPitfall> = [
  // --- Japanese: a learner trips ----------------------------------------------------------------
  ja(
    word("了解", "りょうかい", [
      s(["comprehension", "consent", "understanding", "agreement"], ["n", "vs", "vt"]),
      s(["OK", "roger"], ["int"])
    ]),
    needs(["rude_upward"], { mentions: ["承知", "かしこまり", "superior", "boss"] }),
    "The model doc's example: 了解(しました) is widely taught as too casual for a superior or customer; JMdict says nothing",
    true,
    true
  ),
  ja(
    word("お疲れ様", "おつかれさま", [
      s(["thank you (for your hard work)", "good work"], ["int"]),
      s(["see you", "goodbye", "goodnight"], ["int"])
    ]),
    needs(["set_phrase", "confusable", "rude_upward"]),
    "The model doc's example: a greeting among colleagues at any hour and on leaving work, not a remark on tiredness",
    true
  ),
  ja(
    word("結構", "けっこう", [
      s(["splendid", "nice", "wonderful", "delightful", "lovely", "excellent", "fine"], ["adj-na"]),
      s(["sufficient", "satisfactory", "enough", "fine", "all right", "OK"], ["adj-na"]),
      s(
        ["not needing (any more of something)", "(already) having enough", 'fine (as in "I\'m fine")', "no, thank you"],
        ["adj-na"]
      ),
      s(["rather", "quite", "fairly", "pretty", "surprisingly", "quite a bit", "fairly well"], ["adv"]),
      s(["structure", "construction", "framework", "architecture"], ["n"])
    ]),
    needs(["set_phrase", "confusable"], { mentions: ["no", "refus", "decline"] }),
    "The model doc's example: 結構です reads as yes or no; JMdict's senses 2 and 3 gloss both, but not the ambiguity",
    true
  ),
  ja(
    word("抱く", "だく", [
      s(["to hold in one's arms (e.g. a baby)", "to embrace", "to hug"], ["v5k", "vt"]),
      s(["to have sex with", "to make love to", "to sleep with"], ["v5k", "vt"]),
      s(["to sit on (eggs)", "to brood"], ["v5k", "vt"])
    ]),
    needs(["confusable", "tone", "collocation", "set_phrase"], {
      sense: 0,
      mentions: ["抱きしめ", "ハグ", "sex", "sleep with"]
    }),
    "The model doc's canonical sense-scoped case; JMdict's sense 2 glosses the sexual meaning a hug between adults is heard as",
    true
  ),
  ja(
    word("食う", "くう", [
      s(["to eat"], ["v5u", "vt"], ["male"]),
      s(["to live", "to make a living", "to survive"], ["v5u", "vt"]),
      s(["to bite", "to sting (as insects do)"], ["v5u", "vt"]),
      s(["to tease", "to torment", "to taunt", "to make light of", "to make fun of"], ["v5u", "vt"]),
      s(["to encroach on", "to eat into", "to consume"], ["v5u", "vt"]),
      s(["to defeat a superior", "to threaten a position"], ["v5u", "vt"]),
      s(["to consume time", "to consume resources"], ["v5u", "vt"]),
      s(["to receive something (usu. an unfavourable event)"], ["v5u", "vt"], ["col"]),
      s(["to have sexual relations with a woman, esp. for the first time"], ["v5u", "vt"], ["male", "vulg"])
    ]),
    needs(["rude_upward", "confusable"], { mentions: ["食べる"] }),
    "The model doc's example: JMdict marks the eating sense only male; that it is rough with superiors is beyond the label",
    true
  ),
  ja(
    word("会う", "あう", [
      s(
        ["to meet", "to encounter", "to see", "to come across", "to run into"],
        ["v5u", "vi"],
        [],
        ["逢う may indicate intimacy or emotion, 遭う undesirability"]
      ),
      s(
        [
          "to have (e.g. an accident)",
          "to suffer (e.g. an unpleasant fate)",
          "to encounter",
          "to face",
          "to go through (e.g. a tough time)",
          "to get caught up (in)"
        ],
        ["v5u", "vi"],
        [],
        ["esp. 遭う when in kanji"]
      )
    ]),
    needs(["particle_pattern", "collocation"], { mentions: ["に"] }),
    "Intransitive in JMdict (vi): you meet に (or と) a person, never を, a classic learner error",
    false
  ),
  ja(
    word("乗る", "のる", [
      s(["to get on (train, plane, bus, ship, etc.)", "to get in", "to board", "to take", "to embark"], ["v5r", "vi"]),
      s(["to get on (e.g. a footstool)", "to step on", "to jump on", "to sit on", "to mount"], ["v5r", "vi"]),
      s(["to reach", "to go over", "to pass"], ["v5r", "vi"]),
      s(["to follow", "to stay (on track)", "to go with (the times, etc.)"], ["v5r", "vi"])
    ]),
    needs(["particle_pattern", "collocation"], { mentions: ["に"] }),
    "Intransitive in JMdict (vi): you board に a train, never を, though English 'take the train' has an object",
    false
  ),

  ja(
    word("水", "みず", [
      s(["water (esp. cool or cold)"], ["n"]),
      s(["fluid (esp. in an animal tissue)", "liquid"], ["n"]),
      s(["flood", "floodwaters"], ["n"])
    ]),
    needs(["confusable", "collocation"], { mentions: ["湯"] }),
    "JMdict glosses it 'esp. cool or cold' and cross-refers 湯: hot water is お湯, so 熱い水 is a learner error. Changed from none after the first run",
    false
  ),

  // --- Japanese: the page already says it, or there is nothing to say ---------------------------
  ja(
    word("ご苦労様", "ごくろうさま", [
      s(
        ["thank you (for your hard work)", "I appreciate your efforts"],
        ["exp", "adj-na"],
        ["pol"],
        ["usu. to one's subordinate"]
      )
    ]),
    NONE,
    "JMdict's note (usu. to one's subordinate) already warns; the model doc: no red warning when the dictionary flagged it",
    false
  ),
  ja(
    word("召し上がる", "めしあがる", [s(["to eat", "to drink"], ["v5r", "vt"], ["hon"])]),
    NONE,
    "JMdict tags hon; the label's explanation says it is never about yourself",
    false
  ),
  ja(
    word("てめえ", "てめえ", [
      s(["you"], ["pn"], ["derog", "male"]),
      s(["I", "me", "oneself", "myself", "yourself", "himself", "herself"], ["pn"], ["male"])
    ]),
    NONE,
    "The model doc's example: JMdict tags derog and male",
    false,
    true
  ),
  ja(
    word("ググる", "ググる", [s(["to google", "to do an online search (for)"], ["v5r", "vt"], ["col"])]),
    NONE,
    "JMdict tags col; means what it says",
    false
  ),
  ja(
    word("あなた", "あなた", [
      s(
        ["you"],
        ["pn"],
        [],
        ["trad. polite in ref. to someone of equal or lower status, now oft. regarded as rude or distant"]
      ),
      s(["dear", "honey"], ["pn"], ["fam"], ["used by wives addressing their husbands"])
    ]),
    NONE,
    "JMdict's note already says it is often heard as rude or distant",
    false
  ),
  ja(
    word("電車", "でんしゃ", [s(["train", "electric train"], ["n"])]),
    NONE,
    "Plain core noun (JMdict common, no tags)",
    false
  ),
  ja(word("学校", "がっこう", [s(["school"], ["n"])]), NONE, "Plain core noun (JMdict common, no tags)", false, true),

  // --- English: a learner trips ------------------------------------------------------------------
  en(
    word("how do you do", "", [s(["はじめまして"], ["exp"])]),
    needs(["textbook_english"], { mentions: ["nice to meet you"] }),
    "The model doc's example: taught as はじめまして, but formal and old-fashioned today",
    true,
    true
  ),
  en(
    word("sorry", "/ˈsɑɹi/", [
      s(["ごめんなさい", "すみません"], ["int"]),
      s(["申し訳なく思う", "すまない"], ["adj"], [], ["be sorry for/that ～ の形で"]),
      s(["気の毒に思う", "残念に思う"], ["adj"], [], ["feel sorry for ～ の形で"]),
      s(["え？", "もう一度お願いします"], ["int"], [], ["上昇調で聞き返す"])
    ]),
    needs(["directness", "confusable"], { mentions: ["thank", "excuse me"] }),
    "The model doc's example: すみません also thanks and gets attention; 'sorry' only apologises",
    true
  ),
  en(
    word("of course", "/əvˈkɔː(r)s/", [
      s(["自分が述べることは明白で周知であるが", "勿論", "無論", "言うまでもなく"], ["adv"]),
      s(["（ど忘れや勘違いなどを指摘されたときに言う）そうそう", "そうだった", "なるほど"], ["adv"])
    ]),
    needs(["directness", "tone"]),
    "As a reply it can imply the question was obvious, where もちろん is friendly; 'sure' is safer",
    true
  ),
  en(
    word(
      "juice",
      "/d͡ʒus/",
      [
        s(["ジュース", "果汁", "汁"], ["n"], ["uncountable"]),
        s(["ゴシップ", "面白いうわさ話"], ["n"], ["sl", "uncountable"]),
        s(["電気", "バッテリー残量"], ["n"], ["sl", "uncountable"])
      ],
      drifted("ジュース", ["juice", "soft drink (usu. fruit-based); sweetened drink"])
    ),
    needs(["false_friend"], { mentions: ["soda", "soft drink", "pop"] }),
    "JMdict: ジュース is any sweetened soft drink; English juice is fruit juice. The curated entry has no note",
    false
  ),
  en(
    word(
      "seal",
      "/siːl/",
      [
        s(["アザラシ", "アシカ"], ["n"]),
        s(["封をする", "密封する"], ["v", "vt"]),
        s(["印章", "はんこ", "紋章"], ["n"]),
        s(["封", "封印", "密閉材"], ["n"])
      ],
      drifted("シール", ["seal", "sticker"])
    ),
    needs(["false_friend"], { mentions: ["sticker"] }),
    "JMdict: シール is a sticker; English seal is not. The curated entry has no note",
    false
  ),
  en(
    word(
      "handle",
      "/ˈhæn.d(ə)l/",
      [
        s(["対処する", "扱う", "処理する"], ["v", "vt"]),
        s(["取っ手", "ハンドル", "柄"], ["n"]),
        s(["耐える", "我慢する"], ["v", "vt"], [], ["主に否定文で（I can't handle ...）"])
      ],
      drifted("ハンドル", ["handle", "steering wheel", "handlebar; handlebars", "handle; screen name; username"])
    ),
    needs(["false_friend"], { mentions: ["steering wheel", "handlebar"] }),
    "JMdict: ハンドル is first a steering wheel or handlebars, which English never calls a handle",
    false
  ),
  en(
    word(
      "stove",
      "/stoʊv/",
      [s(["コンロ", "レンジ"], ["n"]), s(["ストーブ", "暖房器具"], ["n"]), s(["（指を）突き指する"], ["v", "vt"])],
      drifted("ストーブ", ["(room) heater; stove"])
    ),
    needs(["false_friend"], { mentions: ["heater"] }),
    "JMdict: ストーブ is a room heater; to most English speakers a stove is for cooking (the curated first sense)",
    true
  ),

  // --- English: the page already says it, or there is nothing to say -------------------------------
  en(
    word(
      "mansion",
      "/ˈmæn.ʃən/",
      [
        s(["豪邸", "大邸宅"], ["n"], [], ["日本語の「マンション」は apartment / condo"]),
        s(["高級アパート", "集合住宅"], ["n"], ["en-GB"], ["主に英国で mansions として建物名に"])
      ],
      drifted("マンション", ["condominium (usu. mid or high-rise); apartment building; apartment house"])
    ),
    NONE,
    "A false friend, but the curated entry's own note already says マンション is an apartment",
    false
  ),
  en(
    word(
      "naive",
      "/naɪˈiv/",
      [
        s(["世間知らずの", "甘い"], ["adj", "n"], [], ["日本語の「ナイーブ（繊細）」とは異なる"]),
        s(["素朴な", "ナイーブアートの"], ["adj"])
      ],
      drifted("ナイーブ", ["innocent; sensitive; uncomplicated"])
    ),
    NONE,
    "A false friend, but the curated entry's own note already says it differs from ナイーブ (繊細)",
    false
  ),
  en(
    word(
      "cunning",
      "/ˈkʌnɪŋ/",
      [
        s(["ずる賢い", "狡猾な"], ["adj"], [], ["「カンニング」は cheating"]),
        s(["ずる賢さ", "悪知恵"], ["n"], ["uncountable"])
      ],
      drifted("カンニング", ["cheating (on an examination); cribbing"])
    ),
    NONE,
    "A false friend, but the curated entry's own note already says カンニング is cheating",
    false
  ),
  en(
    word("yep", "/jɛp/", [s(["うん", "そう", "ああ"], ["int", "n"], ["col"])]),
    NONE,
    "The model doc's example: the col label says it",
    false,
    true
  ),
  en(
    word("fuck", "", [
      s(["性交をする"], ["v"], ["vulg"]),
      s(["くそっ", "畜生", "くそったれ"], ["int"], ["vulg"]),
      s(["くたばる", "失せる"], ["v"], ["vulg"])
    ]),
    NONE,
    "The model doc's example: Japanese Wiktionary tags it vulgar",
    false,
    true
  ),
  en(
    word("crap", "/kɹæp/", [
      s(["くだらないこと", "でたらめ", "ガラクタ"], ["n"], ["col", "vulg"], ["cut the crap（くだらない話はよせ）など"]),
      s(["くそっ", "しまった", "やばい"], ["int"], ["col", "vulg"], ["Holy crap! など"]),
      s(["ひどい", "ろくでもない", "粗悪な"], ["adj"], ["col", "vulg"])
    ]),
    NONE,
    "The curated entry labels every sense col and vulg",
    false
  ),
  en(
    word("book", "/bʊk/", [
      s(["本", "書籍", "著書"], ["n"]),
      s(["予約する", "（切符などを）手配する"], ["v", "vt", "vi"]),
      s(["帳簿", "会計簿"], ["n"], [], ["通例複数形で"])
    ]),
    NONE,
    "Plain core word; its senses say what it means",
    false
  ),
  en(
    word("water", "/ˈwɔ.tɚ/", [
      s(["水"], ["n"], ["uncountable"]),
      s(["水域", "海", "状況"], ["n"], ["uncountable"], ["waters の形で"]),
      s(["水をやる", "水をまく"], ["v", "vt"])
    ]),
    NONE,
    "Plain core word; uncountable is a label, not a pitfall",
    false
  ),
  en(
    word("happy", "/ˈhæpi/", [
      s(["幸せな", "嬉しい"], ["adj"]),
      s(["満足している", "喜んで～する"], ["adj"], [], ["be happy to do / with ～"]),
      s(["おめでとう"], ["adj"], [], ["Happy birthday! など"])
    ]),
    NONE,
    "Plain core word",
    false
  )
]

/** Ask Kotori queries the dictionary lacks: new slang, where the draft's labels carry the register. */
export const GOLDEN_DRAFTS: ReadonlyArray<GoldenDraft> = [
  {
    language: "ja",
    query: "ぴえん",
    expect: needs(["tone"]),
    evidence:
      "Plan, Phase 4: a light, playful 'boo-hoo' for small letdowns, never real grief; came as set_phrase before `tone` existed",
    judgement: true
  },
  {
    language: "ja",
    query: "それな",
    expect: NONE,
    evidence: "Casual 'right?!' agreement among friends; a casual or slang label says all of it",
    judgement: true
  },
  {
    language: "en",
    query: "bussin",
    expect: NONE,
    evidence: "Slang for very good (food); the sl label says it. Phase 4's draft carried a careless pitfall",
    judgement: true
  },
  {
    language: "en",
    query: "rizz",
    expect: NONE,
    evidence: "Slang for charm in flirting; the sl label says it",
    judgement: true
  },
  {
    language: "en",
    query: "no cap",
    expect: NONE,
    evidence: "Slang for 'no lie, for real'; the sl label says it",
    judgement: true
  }
]
