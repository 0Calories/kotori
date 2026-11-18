import type { WordToJudge } from "../judge/word.ts"
import { s, word } from "./goldenWords.ts"

/**
 * Japanese senses with a known answer for `kotori eval ja-form`: formal or literary wording that
 * JMdict leaves untagged (鑑みる, 及び, 当該), and plain words, including business words and their
 * everyday counterparts, that must not be labelled. Every sense here carries no register label in
 * JMdict, as the pass's candidates don't. None of these words is an example in the question.
 *
 * Expected answers are claims about Japanese. `evidence` names a source where one says so;
 * `judgement` marks the answers that rest on the author's judgement alone, for review.
 */
export interface GoldenFormalLabel {
  readonly word: WordToJudge
  /** The sense asked about, by position. */
  readonly sense: number
  readonly formal: boolean
  readonly evidence: string
  readonly judgement: boolean
}

const formal = (w: WordToJudge, sense: number, evidence: string, judgement = true): GoldenFormalLabel => ({
  word: w,
  sense,
  formal: true,
  evidence,
  judgement
})
const plain = (w: WordToJudge, sense: number, evidence: string, judgement = false): GoldenFormalLabel => ({
  word: w,
  sense,
  formal: false,
  evidence,
  judgement
})

const niOite = word("において", "において", [
  s(["at (a time or place)", "in", "on"], ["exp"]),
  s(
    [
      "in (a situation, matter, etc.)",
      "on (a point)",
      "when it comes to",
      "regarding",
      "with respect to",
      "in (terms of)",
      "as to",
      "as for"
    ],
    ["exp"]
  ),
  s(["on the part of", "under the authority of", "in the name of"], ["exp"])
])

const nao = word("なお", "なお", [
  s(["still", "yet"], ["adv"]),
  s(["more", "still more", "greater", "further"], ["adv"]),
  s(["furthermore", "in addition", "moreover", "note that ..."], ["conj"]),
  s(["as if", "just like", "as though"], ["adv"], ["form"], ["as なお ... ごとし; esp. 猶"])
])

export const GOLDEN_FORMAL_LABELS: ReadonlyArray<GoldenFormalLabel> = [
  // --- Formal or literary, untagged ---------------------------------------------------------
  formal(
    word("鑑みる", "かんがみる", [
      s(
        ["to take into account", "to bear in mind", "to consider", "to learn from", "to take as a lesson"],
        ["v1", "vt", "vi"]
      )
    ]),
    0,
    "The model doc's example; in speech natives say 考える or 考慮する"
  ),
  formal(
    word("及び", "および", [s(["and", "as well as"], ["conj"])]),
    0,
    "The model doc's example; the と/や of documents"
  ),
  formal(
    word("当該", "とうがい", [
      s(
        [
          "appropriate (e.g. authorities)",
          "concerned",
          "relevant",
          "said",
          "aforementioned",
          "competent",
          "applicable",
          "respective"
        ],
        ["adj-no"]
      )
    ]),
    0,
    "The model doc's example; glosses in legal English (aforementioned, said)"
  ),
  formal(
    word("並びに", "ならびに", [s(["and (also)", "both ... and", "as well as"], ["conj"])]),
    0,
    "The written 'and' of ceremonies and documents, as 及び"
  ),
  formal(
    word("もしくは", "もしくは", [s(["or", "otherwise"], ["conj"])]),
    0,
    "The written 'or' of documents; speech says か or または"
  ),
  formal(
    word("すなわち", "すなわち", [
      s(["that is (to say)", "namely", "i.e.", "or"], ["conj"]),
      s(["precisely", "exactly", "just", "nothing but", "neither more nor less"], ["conj"]),
      s(
        ["if one does ..., then", "in that case", "then"],
        ["conj"],
        [],
        ["as ...ば～; indicates that what follows is a natural consequence"]
      ),
      s(["so", "accordingly", "thereupon", "then"], ["conj"])
    ]),
    0,
    "Bookish 'namely'; speech says つまり"
  ),
  formal(
    word("遺憾", "いかん", [s(["regrettable", "unsatisfactory", "deplorable", "lamentable"], ["adj-na", "n"])]),
    0,
    "The 'regret' of official statements (遺憾に思う); speech says 残念"
  ),
  formal(
    word("甚だ", "はなはだ", [s(["very", "greatly", "extremely", "exceedingly", "highly", "quite"], ["adv"])]),
    0,
    "Literary 'very'; speech says とても or すごく"
  ),
  formal(
    word("本日", "ほんじつ", [s(["today", "this day"], ["n", "adv"])]),
    0,
    "Japanese Wiktionary: 今日の漢語的表現で、ややかしこまった言い方",
    false
  ),
  formal(
    word("昨今", "さっこん", [s(["these days", "nowadays", "recently", "lately"], ["n", "adv"])]),
    0,
    "Written 'these days'; speech says 最近"
  ),
  formal(
    word("速やか", "すみやか", [s(["quick", "speedy", "prompt", "rapid", "swift"], ["adj-na"])]),
    0,
    "Notices and instructions (速やかに退避); speech says すぐ or 早く"
  ),
  formal(
    word("所存", "しょぞん", [s(["opinion", "intention", "thought"], ["n"])]),
    0,
    "Speeches and letters (努力する所存です); speech says つもり"
  ),
  formal(
    word("拝啓", "はいけい", [
      s(
        ["Dear (so and so)", "Dear Sir", "Dear Madam", "To Whom It May Concern"],
        ["n"],
        [],
        ["letters beginning with this typically end with 敬具"]
      )
    ]),
    0,
    "JMdict's note and Japanese Wiktionary (手紙の冒頭に使用される語): a letter's opening",
    false
  ),
  formal(niOite, 0, "Written 'at, in' (会場において); speech says で"),
  formal(niOite, 1, "Written 'regarding' (この点において); speech says について or では"),
  formal(nao, 2, "The 'note that' of documents and announcements; JMdict tags its literary sense 4 form"),
  formal(
    word("先般", "せんぱん", [s(["some time ago", "the other day"], ["n", "adv"])]),
    0,
    "Business letters; speech says この間 or 先日"
  ),
  formal(
    word("殊に", "ことに", [
      s(["especially", "particularly", "unusually", "above all"], ["adv"]),
      s(["additionally"], ["adv"], ["arch"])
    ]),
    0,
    "Literary 'especially'; speech says 特に"
  ),

  // --- Plain: everyday wording, often the formal word's counterpart ------------------------------
  plain(
    word("考える", "かんがえる", [
      s(
        ["to think (about, of)", "to think over", "to ponder", "to contemplate", "to reflect (on)", "to meditate (on)"],
        ["v1", "vt"]
      ),
      s(["to consider", "to bear in mind", "to allow for", "to take into consideration"], ["v1", "vt"])
    ]),
    1,
    "Core vocabulary (JMdict common); the everyday 鑑みる, glossed alike"
  ),
  plain(
    word("そして", "そして", [s(["and", "and then", "thus", "and now", "and finally"], ["conj"])]),
    0,
    "Common in writing, but fine in conversation",
    true
  ),
  plain(
    word("または", "または", [s(["or", "either ... or ..."], ["conj"])]),
    0,
    "Neutral 'or', said and written alike; the counterpart of もしくは",
    true
  ),
  plain(
    word("残念", "ざんねん", [s(["regrettable", "unfortunate", "disappointing", "vexing"], ["adj-na", "n"])]),
    0,
    "Core vocabulary (JMdict common); glossed like 遺憾"
  ),
  plain(
    word("最近", "さいきん", [
      s(["recently", "lately", "these days", "nowadays", "right now"], ["n", "adj-no", "adv"])
    ]),
    0,
    "Core vocabulary (JMdict common); glossed like 昨今"
  ),
  plain(
    word("とても", "とても", [s(["very", "awfully", "exceedingly"], ["adv"], [], ["とっても is more emphatic"])]),
    0,
    "Core vocabulary (JMdict common); glossed like 甚だ"
  ),
  plain(
    word("つまり", "つまり", [
      s(["that is to say", "that is", "in other words", "I mean", "that (this, it) means"], ["adv"])
    ]),
    0,
    "Core vocabulary (JMdict common); glossed like すなわち"
  ),
  plain(
    word("すぐ", "すぐ", [s(["immediately", "at once", "right away", "directly"], ["adv", "n"])]),
    0,
    "Core vocabulary (JMdict common); glossed like 速やか"
  ),
  plain(
    word("今日", "きょう", [s(["today", "this day"], ["n", "adv"])]),
    0,
    "Core vocabulary (JMdict common); glossed exactly like 本日"
  ),
  plain(
    word("確認", "かくにん", [
      s(
        ["confirmation", "verification", "validation", "review", "check", "affirmation", "identification"],
        ["n", "vs", "vt"]
      )
    ]),
    0,
    "A business word said every day (確認します)",
    true
  ),
  plain(
    word("会議", "かいぎ", [
      s(["meeting", "conference", "session", "assembly", "council", "convention", "congress"], ["n", "vs", "vi", "vt"])
    ]),
    0,
    "A business word said every day (会議中です)",
    true
  ),
  plain(word("食べる", "たべる", [s(["to eat"], ["v1", "vt"])]), 0, "Core vocabulary (JMdict common)"),
  plain(word("友達", "ともだち", [s(["friend", "companion"], ["n"])]), 0, "Core vocabulary (JMdict common)"),
  plain(word("電車", "でんしゃ", [s(["train", "electric train"], ["n"])]), 0, "Core vocabulary (JMdict common)"),
  plain(word("大きい", "おおきい", [s(["big", "large", "great"], ["adj-i"])]), 0, "Core vocabulary (JMdict common)"),
  plain(word("学校", "がっこう", [s(["school"], ["n"])]), 0, "Core vocabulary (JMdict common)")
]
