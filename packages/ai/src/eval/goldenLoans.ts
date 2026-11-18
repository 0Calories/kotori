import type { LoanCandidate } from "../judge/loans.ts"

/**
 * English words with a known loan verdict for `kotori eval loans`: katakana loans that drifted
 * (the English word's false friend), loans that kept their meaning (a "same as" chip), and words
 * whose only candidates are false (no loan). Each word's candidates are those the pass's search
 * finds in JMdict (created 2026-10-27): common katakana words with the word as a gloss or JMdict
 * source, at most three, a source first, then the most used. Their meanings are JMdict's glosses
 * and tag descriptions, CC BY-SA 4.0: see NOTICE.md beside this file.
 *
 * None of these words is an example in the questions. `evidence` names what the verdict rests
 * on; `judgement` marks verdicts that rest on the author's judgement of everyday Japanese.
 */
export interface GoldenLoan {
  readonly english: string
  readonly expect: "true_loanword" | "wasei_eigo" | "no_loan"
  /** The katakana word the verdict is about. */
  readonly katakana?: string
  readonly candidates: ReadonlyArray<LoanCandidate>
  readonly evidence: string
  readonly judgement: boolean
}

const c = (
  katakana: string,
  meanings: ReadonlyArray<string>,
  by: LoanCandidate["by"],
  wasei = false
): LoanCandidate => ({ katakana, meanings, by, wasei })

const style = c("スタイル", ["(one's) figure; build; physique", "style"], "gloss")
const talent = c(
  "タレント",
  [
    "(TV or radio) entertainer; television personality; radio personality",
    "talent; skill",
    "talent (ancient unit of weight and currency) [historical term]"
  ],
  "gloss"
)
const claim = c(
  "クレーム",
  ["claim (for compensation); customer complaint seeking compensation", "(general) complaint; objection"],
  "gloss"
)

const drifted = (
  english: string,
  candidates: ReadonlyArray<LoanCandidate>,
  evidence: string,
  judgement = false
): GoldenLoan => ({ english, expect: "wasei_eigo", katakana: candidates[0]!.katakana, candidates, evidence, judgement })

const same = (
  english: string,
  candidates: ReadonlyArray<LoanCandidate>,
  evidence: string,
  judgement = false
): GoldenLoan => ({
  english,
  expect: "true_loanword",
  katakana: candidates[0]!.katakana,
  candidates,
  evidence,
  judgement
})

const none = (english: string, candidates: ReadonlyArray<LoanCandidate>, evidence: string): GoldenLoan => ({
  english,
  expect: "no_loan",
  candidates,
  evidence,
  judgement: false
})

export const GOLDEN_LOANS: ReadonlyArray<GoldenLoan> = [
  // --- Drifted: the katakana word's everyday meaning misleads in English ----------------------
  drifted(
    "style",
    [
      style,
      c(
        "タイプ",
        [
          "type; kind; sort",
          "type (of person); (ideal) type; one's type",
          "typewriter [abbreviation]",
          "typing (on a typewriter)"
        ],
        "gloss"
      ),
      c(
        "タッチ",
        [
          "touch; touching",
          "being involved in",
          "touch (of a painter, pianist, etc.); style (of writing, drawing, etc.); feel",
          "tag [baseball]",
          "high five; touching palms [children's language]"
        ],
        "gloss"
      )
    ],
    "JMdict's first sense of スタイル: one's figure or physique"
  ),
  drifted(
    "mansion",
    [c("マンション", ["condominium (usu. mid or high-rise); apartment building; apartment house"], "source")],
    "JMdict: a condominium; the curated English entry's note says the same"
  ),
  drifted(
    "tension",
    [
      c(
        "テンション",
        [
          "spirits; excitement; energy level [colloquial]",
          "tension [physics]",
          "tension (mental strain); anxiety [rare term]"
        ],
        "gloss"
      )
    ],
    "JMdict's first sense: spirits, energy level; the curated English note says English lacks it"
  ),
  drifted(
    "naive",
    [c("ナイーブ", ["innocent; sensitive; uncomplicated"], "source")],
    "JMdict: innocent, sensitive; the curated English note says it differs (繊細)"
  ),
  drifted(
    "smart",
    [
      c("スマート", ["smart (clothing, etc.); stylish", "slim; slender", "skilful; slick; clever"], "gloss"),
      c("シック", ["chic; stylish; smart"], "gloss")
    ],
    "JMdict: スマート is also slim; the curated English note says smart never means slim"
  ),
  drifted("claim", [claim], "JMdict: a (customer) complaint; the curated English note says so"),
  drifted(
    "juice",
    [c("ジュース", ["juice", "soft drink (usu. fruit-based); sweetened drink"], "gloss")],
    "JMdict's second sense: any sweetened soft drink, which English doesn't call juice"
  ),
  drifted(
    "seal",
    [c("シール", ["seal", "sticker"], "gloss")],
    "JMdict's second sense: a sticker, the everyday use; English seal never means one",
    true
  ),
  drifted(
    "handle",
    [
      c(
        "ハンドル",
        ["handle", "steering wheel", "handlebar; handlebars", "handle; screen name; username [Internet]"],
        "gloss"
      )
    ],
    "JMdict: also a steering wheel or handlebars, which English never calls a handle"
  ),
  drifted(
    "stove",
    [
      c("ストーブ", ["(room) heater; stove"], "gloss"),
      c("レンジ", ["range; stove; cooker", "microwave oven [abbreviation]"], "gloss")
    ],
    "JMdict: a room heater; to most English speakers a stove is for cooking",
    true
  ),
  drifted(
    "cooler",
    [c("クーラー", ["air conditioner", "cooler"], "gloss")],
    "JMdict's first sense: an air conditioner, which English doesn't call a cooler"
  ),
  drifted(
    "talent",
    [{ ...talent, by: "source" }],
    "JMdict's first sense: a TV personality; the curated English note says タレント is a celebrity"
  ),

  // --- Kept its meaning: the English word can be used wherever the loan is ----------------------
  same("table", [c("テーブル", ["table"], "gloss")], "JMdict glosses テーブル only as table"),
  same(
    "coffee",
    [
      c("コーヒー", ["coffee [word usually written using kana alone]"], "source"),
      c("ホット", ["hot", "(hot) coffee [abbreviation]"], "gloss")
    ],
    "JMdict glosses コーヒー only as coffee"
  ),
  same("camera", [c("カメラ", ["camera"], "gloss")], "JMdict glosses カメラ only as camera"),
  same("door", [c("ドア", ["door"], "gloss")], "JMdict glosses ドア only as door"),
  same("hotel", [c("ホテル", ["hotel"], "gloss")], "JMdict glosses ホテル only as hotel"),
  same(
    "test",
    [
      c(
        "テスト",
        [
          "test (of ability, knowledge, etc.); exam; examination",
          "test (of performance, quality, etc.); trial",
          "rehearsal"
        ],
        "gloss"
      )
    ],
    "JMdict: every sense is one English test has (a rehearsal is a test run)",
    true
  ),
  same(
    "game",
    [
      c("ゲーム", ["game"], "gloss"),
      c(
        "プレイ",
        [
          "play; recreation",
          "playing (a sport); play; game",
          "playing (a musical instrument); musical performance",
          "play (theatrical performance)",
          "play ball; starting a match [abbreviation; sports]"
        ],
        "gloss"
      )
    ],
    "JMdict glosses ゲーム only as game"
  ),
  same(
    "card",
    [
      c(
        "カード",
        [
          "card (information, filing, etc.)",
          "card (greetings, congratulations, etc.)",
          "(Western) playing cards",
          "credit card; debit card [abbreviation]",
          "card; program; matchup [sports]",
          "card (to play); (one's) hand; bargaining chip"
        ],
        "gloss"
      )
    ],
    "JMdict: all six senses are English card's"
  ),
  same(
    "team",
    [
      c("チーム", ["team"], "gloss"),
      c("イレブン", ["eleven", "team (of eleven players; esp. in soccer) [sports]"], "gloss"),
      c("クラブ", ["nightclub", "sports club; team", "(golf) club", "clubs (suit) [card games]"], "gloss")
    ],
    "JMdict glosses チーム only as team; イレブン and クラブ are other words' loans"
  ),
  same(
    "chance",
    [c("チャンス", ["chance; opportunity"], "gloss"), c("フロック", ["fluke; chance; unexpected event"], "gloss")],
    "JMdict: chance, opportunity, which English chance means"
  ),
  same("hint", [c("ヒント", ["hint; clue"], "gloss")], "JMdict: hint, clue"),
  same("member", [c("メンバー", ["member; participant; attendee"], "gloss")], "JMdict: member, participant"),
  same(
    "advice",
    [c("アドバイス", ["advice"], "gloss")],
    "The model doc's example of a 'same as' chip; JMdict glosses アドバイス only as advice"
  ),

  // --- No loan: the only candidates are other words' loans --------------------------------------------
  none(
    "walk",
    [c("フォアボール", ["base on balls; walk; pass [baseball]"], "gloss", true)],
    "フォアボール is wasei from 'four balls'"
  ),
  none(
    "launch",
    [
      c(
        "オープニング",
        [
          "opening; start; launch",
          "opening credits; title sequence [abbreviation]",
          "theme song (played during the opening credits of a TV show, etc.) [abbreviation]"
        ],
        "gloss"
      )
    ],
    "オープニング is the loan of opening"
  ),
  none("complaint", [claim], "クレーム is the loan of claim"),
  none("entertainer", [talent], "タレント is the loan of talent"),
  none("physique", [style], "スタイル is the loan of style"),
  none(
    "cheating",
    [
      c("カンニング", ["cheating (on an examination); cribbing"], "gloss"),
      c("インチキ", ["cheating; fraud; trickery", "fake; bogus; quack"], "gloss")
    ],
    "カンニング is the loan of cunning; インチキ is not English"
  )
]
