import type { EntryRecord } from "@kotori/db"
import type {
  AgeGroup,
  Connotation,
  Currency,
  Difference,
  Formality,
  Gender,
  Keigo,
  LoanVerdict,
  Medium,
  Profanity,
  RegisterShape,
  Variety
} from "@kotori/domain"
import { Schema } from "effect"

/**
 * The golden set: dictionary senses with known-correct judgments, seeded from failures caught
 * in production and padded with ordinary words as controls. Each names a real entry and sense,
 * of JMDict (`kotori eval nuance`) or of the English dictionary (`kotori eval english`), and the
 * eval builds its request from that entry with the production builders and interprets the
 * answers with the entry's own tags, so it measures what learners are shown. The entries come
 * from `GOLDEN_FIXTURE`, cut from the downloads by `tools/golden-fixture.ts`. Scale expectations list every acceptable label
 * (adjacent labels are often both defensible); boolean expectations are judged at the display
 * threshold (probability >= 0.6).
 */

export interface GoldenExpectation {
  readonly formality?: ReadonlyArray<Formality>
  readonly medium?: ReadonlyArray<Medium>
  readonly keigo?: Keigo
  readonly gender?: Gender
  readonly age?: AgeGroup
  readonly currency?: Currency
  readonly connotation?: Connotation
  readonly registerShape?: RegisterShape
  readonly rudeToSuperiors?: boolean
  readonly stiffWithFriends?: boolean
  readonly slang?: boolean
  /** English words only, as the next three. */
  readonly variety?: Variety
  readonly profanity?: Profanity
  readonly textbook?: boolean
}

export interface GoldenSense {
  /** The word as the golden set knows it, for reports; one of the entry's forms. */
  readonly word: string
  readonly entryId: number
  readonly sense: number
  readonly expect: GoldenExpectation
}

const g = (word: string, entryId: number, sense: number, expect: GoldenExpectation): GoldenSense => ({
  word,
  entryId,
  sense,
  expect
})

export const GOLDEN_SENSES: ReadonlyArray<GoldenSense> = [
  // --- Vulgar and fixed-register words: the slider is the wrong model ---------
  g("てめえ", 2076920, 0, { formality: ["vulgar"], registerShape: "fixed", rudeToSuperiors: true }),
  g("くそ", 1504900, 0, { formality: ["vulgar"], registerShape: "fixed", rudeToSuperiors: true }),
  g("ぶっ殺す", 1603170, 0, { formality: ["vulgar"], registerShape: "fixed" }),
  g("馬鹿", 1601260, 0, { formality: ["vulgar", "casual"], connotation: "negative", rudeToSuperiors: true }),
  g("デブ", 1083820, 1, { formality: ["vulgar", "casual"], connotation: "negative" }),
  // --- Casual words and slang --------------------------------------------------
  g("めっちゃ", 2183440, 0, {
    formality: ["casual"],
    medium: ["spoken"],
    rudeToSuperiors: true,
    stiffWithFriends: false
  }),
  // The "amazing" sense, the one the slang expectation is about.
  g("やばい", 1012840, 2, { formality: ["casual"], medium: ["spoken"], slang: true }),
  g("マジ", 1127680, 0, { formality: ["casual"], medium: ["spoken"], slang: true, age: "youth" }),
  g("うまい", 1310460, 1, { formality: ["casual"], rudeToSuperiors: true }),
  g("食う", 1592100, 0, { formality: ["casual", "vulgar"], rudeToSuperiors: true, gender: "masculine" }),
  g("飯", 1482010, 0, { formality: ["casual"], rudeToSuperiors: true }),
  g("うん", 1001090, 0, { formality: ["casual"], medium: ["spoken"], rudeToSuperiors: true }),
  g("でかい", 1008370, 0, { formality: ["casual"], rudeToSuperiors: true }),
  g("ググる", 2018460, 0, { formality: ["casual"], slang: true }),
  g("エモい", 2768450, 0, { formality: ["casual"], slang: true, age: "youth", currency: "trendy" }),
  g("バイト", 1097870, 0, { formality: ["casual", "neutral"], stiffWithFriends: false }),
  g("あんた", 1979920, 0, { formality: ["casual"], medium: ["spoken"], rudeToSuperiors: true }),
  g("お前", 1002290, 0, { formality: ["casual", "vulgar"], rudeToSuperiors: true, gender: "masculine" }),
  g("俺", 1576870, 0, { formality: ["casual"], gender: "masculine", rudeToSuperiors: true }),
  g("あたし", 1311125, 0, { formality: ["casual"], gender: "feminine", medium: ["spoken"] }),
  g("僕", 1521400, 0, { formality: ["casual", "neutral"], gender: "masculine" }),
  g("やっぱり", 1012810, 0, { formality: ["casual", "neutral"], medium: ["spoken"], rudeToSuperiors: false }),
  g("ちゃんと", 1007720, 1, { formality: ["casual", "neutral"], medium: ["spoken"] }),
  g("すごく", 2272830, 0, { formality: ["casual", "neutral"], rudeToSuperiors: false, slang: false }),
  // --- Neutral controls: nothing should fire -----------------------------------
  g("歩く", 1514320, 0, {
    formality: ["neutral"],
    medium: ["both"],
    registerShape: "scaled",
    rudeToSuperiors: false,
    stiffWithFriends: false,
    slang: false
  }),
  g("学校", 1206730, 0, { formality: ["neutral"], medium: ["both"] }),
  g("時間", 1315920, 0, { formality: ["neutral"], stiffWithFriends: false }),
  g("食べる", 1358280, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("水", 1371260, 0, { formality: ["neutral"], medium: ["both"] }),
  g("犬", 1258330, 0, { formality: ["neutral"] }),
  g("会社", 1198550, 0, { formality: ["neutral"] }),
  g("行く", 1578850, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("大きい", 1588880, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("分かる", 1606560, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("美味しい", 1486650, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("見る", 1259290, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("死ぬ", 1310730, 0, { formality: ["neutral"], rudeToSuperiors: false }),
  g("素晴らしい", 1397300, 0, { formality: ["neutral", "polite"], connotation: "positive" }),
  // --- Polite words and keigo ---------------------------------------------------
  g("お手洗い", 1002100, 0, { formality: ["polite"], rudeToSuperiors: false }),
  g("ございます", 1612690, 0, { formality: ["polite", "formal"], keigo: "teineigo", stiffWithFriends: true }),
  g("よろしい", 1224880, 0, { formality: ["polite"] }),
  g("お茶", 1002430, 0, { formality: ["neutral", "polite"], keigo: "bikago", stiffWithFriends: false }),
  g("ご飯", 1270590, 0, { formality: ["neutral"], keigo: "bikago", rudeToSuperiors: false }),
  g("召し上がる", 1346370, 0, {
    formality: ["formal"],
    keigo: "sonkeigo",
    stiffWithFriends: true,
    rudeToSuperiors: false
  }),
  // JMDict lists the noun 拝見 (a する verb); 拝見する isn't an entry of its own.
  g("拝見", 1472270, 0, { formality: ["formal"], keigo: "kenjougo", stiffWithFriends: true, currency: "current" }),
  g("伺う", 1305700, 0, { formality: ["formal", "polite"], keigo: "kenjougo" }),
  g("申す", 1363090, 0, { formality: ["formal"], keigo: "kenjougo", stiffWithFriends: true }),
  g("いらっしゃる", 1000940, 0, { formality: ["formal", "polite"], keigo: "sonkeigo" }),
  g("おっしゃる", 1238840, 0, { formality: ["formal", "polite"], keigo: "sonkeigo" }),
  g("誠に", 1381160, 0, { formality: ["formal"], stiffWithFriends: true }),
  // ご逝去 isn't an entry; 逝去 is, tagged honorific.
  g("逝去", 1381360, 0, { formality: ["formal"], registerShape: "fixed" }),
  g("恐縮", 1236740, 0, { formality: ["formal"], currency: "current", age: "any", stiffWithFriends: true }),
  // --- Written and bookish words -------------------------------------------------
  g("鑑みる", 1215170, 0, { medium: ["written"], stiffWithFriends: true }),
  g("及び", 1228140, 0, { medium: ["written"], stiffWithFriends: true }),
  g("当該", 1448970, 0, { medium: ["written"], stiffWithFriends: true }),
  g("遺憾", 1159090, 0, { medium: ["written"], formality: ["formal", "neutral"] }),
  g("故に", 1267130, 0, { medium: ["written"], stiffWithFriends: true }),
  // --- Sneaky words: polite-looking but rude upward — the caution's whole point --
  // The interjection ("roger"), the 了解です said to a boss.
  g("了解", 1553310, 1, { rudeToSuperiors: true, stiffWithFriends: false }),
  g("ご苦労様", 1005030, 0, { rudeToSuperiors: true }),
  g("お疲れ様", 1002570, 0, { formality: ["polite"], rudeToSuperiors: false }),
  // --- Delicate subjects: register, not subject (the SUBJECT_NOT_REGISTER guard) --
  g("妊娠", 1467350, 0, {
    formality: ["neutral"],
    medium: ["both"],
    registerShape: "scaled",
    stiffWithFriends: false
  }),
  g("勃起", 1521920, 0, { formality: ["neutral"], registerShape: "split", stiffWithFriends: false }),
  g("性交", 1375330, 0, { medium: ["written"], stiffWithFriends: true }),
  g("セックス", 1074570, 0, { formality: ["casual", "neutral"], stiffWithFriends: false }),
  g("おっぱい", 1001370, 0, { formality: ["casual"], rudeToSuperiors: true }),
  g("便秘", 1512580, 0, { formality: ["neutral"], stiffWithFriends: false }),
  g("生理", 1379580, 1, { formality: ["neutral"], medium: ["both"] }),
  g("浣腸", 1568700, 0, { formality: ["neutral"], registerShape: "split" }),
  g("うんこ", 1001100, 0, { formality: ["casual", "vulgar"], rudeToSuperiors: true }),
  g("トイレ", 1084810, 0, { formality: ["neutral"], stiffWithFriends: false }),
  // --- Gender, age and currency markers ------------------------------------------
  g("かしら", 1002800, 0, { gender: "feminine", medium: ["spoken"] }),
  g("わんわん", 1149310, 3, { age: "children", formality: ["casual"] }),
  g("おてて", 2080240, 0, { age: "children" }),
  g("ハイカラ", 1095010, 0, { currency: "dated" }),
  g("ナウい", 1924310, 0, { currency: "dated", slang: true }),
  g("候", 2395790, 1, { currency: "archaic", medium: ["written"] }),
  g("汝", 2015140, 0, { currency: "archaic" }),
  g("銀幕", 1243590, 1, { currency: "dated" })
]

// --- Similar words ----------------------------------------------------------------

export interface GoldenPairExpectation {
  /** Whether the candidate is a near-synonym, at the threshold the enricher keeps it. */
  readonly similar: boolean
  /** The acceptable answers to "how does it differ"; only asked of near-synonyms. */
  readonly difference?: ReadonlyArray<Difference>
}

/** A word's sense and a similar-word candidate, as the nuance job compares them. */
export interface GoldenPair {
  readonly word: string
  readonly entryId: number
  readonly sense: number
  readonly similar: string
  readonly similarId: number
  /** The candidate's sense that shares the meaning, as the candidate search picks it. */
  readonly similarSense: number
  readonly expect: GoldenPairExpectation
}

const p = (
  word: string,
  entryId: number,
  sense: number,
  similar: string,
  similarId: number,
  similarSense: number,
  expect: GoldenPairExpectation
): GoldenPair => ({ word, entryId, sense, similar, similarId, similarSense, expect })

export const GOLDEN_PAIRS: ReadonlyArray<GoldenPair> = [
  p("食べる", 1358280, 0, "食う", 1592100, 0, { similar: true, difference: ["more_casual"] }),
  p("食べる", 1358280, 0, "召し上がる", 1346370, 0, { similar: true, difference: ["respectful"] }),
  p("食べる", 1358280, 0, "いただく", 1587290, 1, { similar: true, difference: ["humble"] }),
  p("食べる", 1358280, 0, "食らう", 1592410, 0, { similar: true, difference: ["more_casual"] }),
  p("言う", 1587040, 0, "おっしゃる", 1238840, 0, { similar: true, difference: ["respectful"] }),
  p("言う", 1587040, 0, "申す", 1363090, 0, { similar: true, difference: ["humble"] }),
  p("言う", 1587040, 0, "述べる", 1340820, 0, { similar: true, difference: ["more_formal", "more_literary"] }),
  p("行く", 1578850, 0, "いらっしゃる", 1000940, 0, { similar: true, difference: ["respectful"] }),
  p("行く", 1578850, 0, "参る", 1302070, 0, { similar: true, difference: ["humble"] }),
  p("見る", 1259290, 0, "拝見", 1472270, 0, { similar: true, difference: ["humble"] }),
  p("思う", 1589350, 0, "存じる", 1406140, 1, { similar: true, difference: ["humble"] }),
  p("買う", 1473740, 0, "購入", 1282440, 0, { similar: true, difference: ["more_formal", "more_literary"] }),
  p("始める", 1307550, 0, "開始", 1202760, 0, { similar: true, difference: ["more_formal", "more_literary"] }),
  p("友達", 1540170, 0, "友人", 1540150, 0, { similar: true, difference: ["more_formal"] }),
  p("トイレ", 1084810, 0, "お手洗い", 1002100, 0, { similar: true, difference: ["more_formal"] }),
  p("腹", 1501110, 0, "お腹", 1002610, 0, { similar: true, difference: ["more_formal"] }),
  p("美味しい", 1486650, 0, "うまい", 1310460, 1, { similar: true, difference: ["more_casual"] }),
  // Related, but not the same meaning: the enricher must drop these.
  p("食べる", 1358280, 0, "飲む", 1169870, 0, { similar: false }),
  p("犬", 1258330, 0, "猫", 1467640, 0, { similar: false }),
  p("学校", 1206730, 0, "会社", 1198550, 0, { similar: false })
]

// --- English words, for Japanese speakers ------------------------------------------
//
// Senses of the English dictionary, named by headword: its ids are numbered at import. Each
// names how its sense's Japanese glosses start, so a re-import that reorders senses is caught.
// Senses are ranked at import (`commonestFirst` in packages/eiwa), and only the first
// `MAX_SENSES` are judged, so every golden is one of those. None
// is an example in its own question's criteria.

export interface GoldenEnglishSense {
  /** The English headword. */
  readonly word: string
  readonly sense: number
  /** How the sense's Japanese glosses start, joined with 、 as the app shows them. */
  readonly gloss: string
  readonly expect: GoldenExpectation
}

const en = (word: string, sense: number, gloss: string, expect: GoldenExpectation): GoldenEnglishSense => ({
  word,
  sense,
  gloss,
  expect
})

export const GOLDEN_ENGLISH_SENSES: ReadonlyArray<GoldenEnglishSense> = [
  // --- Crude and rude words: register, the cautions and how offensive ---------------------
  en("asshole", 1, "ばか", {
    formality: ["vulgar"],
    rudeToSuperiors: true,
    profanity: "strong",
    registerShape: "fixed"
  }),
  en("bitch", 0, "嫌な女、くそばばあ", { formality: ["vulgar"], profanity: "strong", connotation: "negative" }),
  en("motherfucker", 0, "マザーファッカー、下衆野郎", { formality: ["vulgar"], profanity: "strong" }),
  en("piss", 1, "小便をする、放尿する", { formality: ["vulgar", "casual"], profanity: "mild" }),
  en("hell", 3, "ちくしょう", { profanity: "mild", rudeToSuperiors: true }),
  en("idiot", 0, "（略語・時に侮蔑）大ばか、間抜け", {
    registerShape: "fixed",
    rudeToSuperiors: true,
    connotation: "negative"
  }),
  en("jerk", 2, "自己中心的で性格が悪い人", { slang: true, registerShape: "fixed", connotation: "negative" }),
  en("dick", 2, "刑事、探偵", { slang: true }),
  // --- Casual everyday speech -------------------------------------------------------------
  en("yep", 0, "うん(yes)", { formality: ["casual"], medium: ["spoken"], rudeToSuperiors: true }),
  en("nope", 0, "いいや、いえ(no)", { formality: ["casual"], medium: ["spoken"], rudeToSuperiors: true }),
  en("okay", 0, "（賛同・許可の意を示す）よろしい、いいよ、オーケイ、オッケイ", {
    formality: ["casual", "neutral"],
    medium: ["spoken"],
    stiffWithFriends: false
  }),
  en("hey", 0, "おや、おい、へえ、ちょっと(注意を促したり,喜び・驚き・困惑などの突然わき起こった感情の発声)", {
    formality: ["casual"],
    medium: ["spoken"]
  }),
  en("buddy", 2, "（主に男性への呼びかけ）おい、お前", { formality: ["casual"], rudeToSuperiors: true }),
  en("whatever", 4, "不承不承従うときの返答", { rudeToSuperiors: true, formality: ["casual"] }),
  // --- Plain words, as controls --------------------------------------------------------------
  en("house", 0, "家", {
    formality: ["neutral"],
    medium: ["both"],
    currency: "current",
    variety: "universal",
    profanity: "none",
    registerShape: "scaled",
    slang: false
  }),
  en("water", 0, "水", { formality: ["neutral"], connotation: "neutral", variety: "universal", profanity: "none" }),
  en("eat", 0, "～を食べる", { formality: ["neutral"], medium: ["both"], stiffWithFriends: false, profanity: "none" }),
  en("help", 0, "手伝う", { rudeToSuperiors: false, stiffWithFriends: false, registerShape: "scaled" }),
  en("understand", 0, "分かる、理解する", { formality: ["neutral"], rudeToSuperiors: false }),
  en("sorry", 0, "申し訳なく思って", { rudeToSuperiors: false }),
  en("buy", 0, "～を買う、購入する", { formality: ["neutral"], stiffWithFriends: false }),
  en("live", 1, "住む", { formality: ["neutral"], stiffWithFriends: false }),
  en("friend", 0, "友達、友人", { slang: false, formality: ["neutral"] }),
  en("money", 0, "（最も一般的な意味で）金銭、お金", { slang: false }),
  en("police", 0, "（通常 the をつけて複数扱い）警察", { slang: false, rudeToSuperiors: false }),
  // Everyday words for the body are everyday vocabulary, not stiff and not offensive.
  en("penis", 0, "陰茎、ペニス", { medium: ["both"], profanity: "none", rudeToSuperiors: false }),
  // --- Formal and written words: the stiff-between-friends caution ----------------------------
  en("reside", 0, "住む、居住する", { formality: ["formal"], stiffWithFriends: true }),
  en("terminate", 0, "止める、打ち切る、途中のまま終わらせる", { formality: ["formal"], stiffWithFriends: true }),
  en("ascertain", 0, "確かめる、確認する、突き止める", {
    formality: ["formal"],
    medium: ["written"],
    stiffWithFriends: true
  }),
  en("purchase", 1, "買う", { formality: ["formal", "polite"], stiffWithFriends: true }),
  en("furthermore", 0, "（重要なことを付け加える時）その上、おまけに", { medium: ["written"], stiffWithFriends: true }),
  en("whereas", 0, "…であるのに反して、なのに対して", { medium: ["written"], formality: ["formal"] }),
  en("thereby", 0, "それによって、従って", { formality: ["formal"], medium: ["written"], stiffWithFriends: true }),
  en("henceforth", 0, "今後は、これからは", { medium: ["written"], stiffWithFriends: true }),
  en("nevertheless", 0, "～にもかかわらず", { formality: ["formal", "neutral"], medium: ["written", "both"] }),
  en("gentleman", 2, "男性の上品な表現", { formality: ["polite", "formal"] }),
  // --- How current ---------------------------------------------------------------------------
  en("thou", 0, "（ごく稀）二人称単数の主格形、汝", { currency: "archaic" }),
  en("hither", 0, "ここへ、こちらへ", { currency: "archaic" }),
  en("thee", 0, "（古語、雅語）汝を、汝に、あなたを、あんたに", { currency: "archaic" }),
  en("gramophone", 0, "蓄音機", { currency: "dated" }),
  en("motorcar", 0, "自動車automobile", { currency: "dated" }),
  // --- Feeling ---------------------------------------------------------------------------------
  en("stingy", 0, "けちな、しみったれの", { connotation: "negative" }),
  en("smug", 0, "自惚れた、独り善がりの", { connotation: "negative" }),
  en("thrifty", 0, "倹しい、倹約している", { connotation: "positive" }),
  en("confident", 1, "自信に満ちた", { connotation: "positive" }),
  // --- Whose English ---------------------------------------------------------------------------
  en("sidewalk", 0, "歩道、人道", { variety: "american" }),
  en("faucet", 0, "（水道や樽の）蛇口、栓、コック", { variety: "american" }),
  en("gasoline", 0, "ガソリン", { variety: "american" }),
  en("vacation", 0, "休暇、バカンス", { variety: "american" }),
  en("cookie", 0, "クッキー", { variety: "american" }),
  en(
    "apartment",
    0,
    "共同住宅内の１世帯分の区画された居住空間、または、そのような居住空間から構成された建物、アパルトマン（日本のアパートよりはマンションと呼ばれるものにイメージは近い）",
    {
      variety: "american"
    }
  ),
  en("petrol", 0, "（主に）ガソリン", { variety: "british" }),
  en("queue", 0, "（何かを待つ）行列、列、類義語:（米）line", { variety: "british" }),
  en("rubbish", 0, "ごみ", { variety: "british" }),
  en("biscuit", 0, "ビスケット、小麦粉を主原料とした、サクサクとした食感の菓子", { variety: "british" }),
  en("trousers", 0, "ズボン", { variety: "british" })
]

export interface GoldenEnglishPair {
  readonly word: string
  readonly sense: number
  readonly similar: string
  readonly similarSense: number
  readonly expect: GoldenPairExpectation
}

const ep = (
  word: string,
  sense: number,
  similar: string,
  similarSense: number,
  expect: GoldenPairExpectation
): GoldenEnglishPair => ({ word, sense, similar, similarSense, expect })

export const GOLDEN_ENGLISH_PAIRS: ReadonlyArray<GoldenEnglishPair> = [
  ep("big", 0, "large", 0, { similar: true }),
  ep("talk", 0, "speak", 0, { similar: true }),
  ep("happy", 2, "glad", 0, { similar: true }),
  ep("buy", 0, "purchase", 1, { similar: true, difference: ["more_formal"] }),
  ep("start", 1, "commence", 0, { similar: true, difference: ["more_formal"] }),
  ep("eat", 3, "dine", 0, { similar: true, difference: ["more_formal", "more_specific"] }),
  ep("child", 0, "kid", 3, { similar: true, difference: ["more_casual", "more_colloquial"] }),
  ep("awkward", 0, "clumsy", 0, { similar: true }),
  ep("dog", 0, "cat", 0, { similar: false }),
  ep("eat", 0, "drink", 0, { similar: false }),
  ep("school", 0, "company", 0, { similar: false }),
  ep("house", 0, "water", 0, { similar: false })
]

/**
 * Loanword false friends, judged once per English word: the スタイル problem, where precision
 * is the feature. `loanWord` is the katakana loan a verdict is about, as JMDict spells it.
 */
export interface GoldenLoan {
  readonly word: string
  readonly loan: LoanVerdict | "no_loan"
  readonly loanWord?: string
}

const l = (word: string, loan: GoldenLoan["loan"], loanWord?: string): GoldenLoan => ({
  word,
  loan,
  ...(loanWord === undefined ? {} : { loanWord })
})

export const GOLDEN_LOANS: ReadonlyArray<GoldenLoan> = [
  // --- Drifted: the katakana word's everyday Japanese misleads ---------------------------
  l("style", "diverges", "スタイル"),
  l("mansion", "diverges", "マンション"),
  l("tension", "diverges", "テンション"),
  l("naive", "diverges", "ナイーブ"),
  l("smart", "diverges", "スマート"),
  l("cunning", "diverges", "カンニング"),
  l("claim", "diverges", "クレーム"),
  l("talent", "diverges", "タレント"),
  l("juice", "diverges", "ジュース"),
  l("bike", "diverges", "バイク"),
  l("seal", "diverges", "シール"),
  // Shares "sign; indication", but サイン is first an autograph or signature.
  l("sign", "diverges", "サイン"),
  // --- Carried over as is: instant comprehension, shown quietly ----------------------------
  l("table", "matches", "テーブル"),
  l("coffee", "matches", "コーヒー"),
  l("camera", "matches", "カメラ"),
  l("computer", "matches", "コンピュータ"),
  l("door", "matches", "ドア"),
  l("hotel", "matches", "ホテル"),
  // Loans with several dictionary senses that English shares, against flagging every loan
  // whose dictionary entry runs past one sense.
  l("ball", "matches", "ボール"),
  l("test", "matches", "テスト"),
  // --- No common loan --------------------------------------------------------------------
  l("walk", "no_loan"),
  l("borrow", "no_loan"),
  l("shallow", "no_loan")
]

// --- The fixture -------------------------------------------------------------------

/** Where the golden entries live, from the workspace root. */
export const GOLDEN_FIXTURE = "packages/nuance/golden/entries.json"

const Codes = Schema.optional(Schema.Array(Schema.String))

/** A judged sense as the request builders read it; empty lists are left out. */
const FixtureSense = Schema.Struct({
  glosses: Schema.Array(Schema.String),
  pos: Schema.Array(Schema.String),
  misc: Codes,
  fields: Codes,
  dialects: Codes,
  info: Codes,
  sources: Codes,
  wasei: Schema.optional(Schema.Boolean)
})

/** An entry cut down to what the request builders read: its spellings and its judged senses. */
export const FixtureEntry = Schema.Struct({
  id: Schema.Int,
  /** Absent on Japanese words. */
  language: Schema.optional(Schema.Literals(["ja", "en"])),
  headword: Schema.String,
  reading: Schema.String,
  common: Schema.Boolean,
  kanji: Codes,
  kana: Codes,
  /** An English word's spellings, the headword first. */
  spellings: Codes,
  senses: Schema.Array(FixtureSense)
})
export type FixtureEntry = typeof FixtureEntry.Type

/**
 * A golden English word's katakana loan candidates in JMDict, as the dictionary lookup finds them
 * (`loanCandidatesIn`): by gloss alone, as production does until JMDict is re-imported with
 * `lsource`, and by gloss or source, as it does after.
 */
const FixtureCandidate = Schema.Struct({ entryId: Schema.Int, by: Schema.Literals(["gloss", "source"]) })
const FixtureLoans = Schema.Struct({
  glossesOnly: Schema.Array(FixtureCandidate),
  withSources: Schema.Array(FixtureCandidate)
})

/** The entries the golden set names, as `tools/golden-fixture.ts` cuts them from the two dictionaries. */
export const GoldenFixture = Schema.Struct({
  about: Schema.String,
  /** Labels of the tag codes the entries use, as JMDict declares them. */
  tags: Schema.Record(Schema.String, Schema.String),
  entries: Schema.Array(FixtureEntry),
  /** Per golden English word (normalised), its katakana candidates in JMDict, most frequent first. */
  loans: Schema.Record(Schema.String, FixtureLoans)
})
export type GoldenFixture = typeof GoldenFixture.Type

/** A fixture entry as the dictionary would return it; what the builders don't read is left empty. */
export const goldenEntry = (entry: FixtureEntry): EntryRecord => {
  const form = (kind: "kanji" | "kana" | "spelling") => (text: string) => ({
    kind,
    text,
    common: false,
    tags: [],
    priorities: [],
    restrictions: [],
    noKanji: false
  })
  return {
    id: entry.id,
    language: entry.language ?? "ja",
    headword: entry.headword,
    reading: entry.reading,
    common: entry.common,
    priority: 0,
    forms: [
      ...(entry.kanji ?? []).map(form("kanji")),
      ...(entry.kana ?? []).map(form("kana")),
      ...(entry.spellings ?? []).map(form("spelling"))
    ],
    senses: entry.senses.map((sense) => ({
      glosses: sense.glosses.map((text) => ({ text, type: null })),
      pos: sense.pos,
      misc: sense.misc ?? [],
      fields: sense.fields ?? [],
      dialects: sense.dialects ?? [],
      info: sense.info ?? [],
      stagk: [],
      stagr: [],
      xrefs: [],
      antonyms: [],
      sources: sense.sources ?? [],
      wasei: sense.wasei ?? false
    }))
  }
}

/** The inverse of `goldenEntry`, for the fixture tool. */
export const fixtureEntry = (entry: EntryRecord, senses: number): FixtureEntry => {
  const of = (kind: EntryRecord["forms"][number]["kind"]) =>
    entry.forms.filter((form) => form.kind === kind).map((form) => form.text)
  const [kanji, kana, spellings] = [of("kanji"), of("kana"), of("spelling")]
  return {
    id: entry.id,
    ...(entry.language === "en" ? { language: "en" as const } : {}),
    headword: entry.headword,
    reading: entry.reading,
    common: entry.common,
    ...(kanji.length > 0 ? { kanji } : {}),
    ...(kana.length > 0 ? { kana } : {}),
    ...(spellings.length > 0 ? { spellings } : {}),
    senses: entry.senses.slice(0, senses).map((sense) => ({
      glosses: sense.glosses.map((gloss) => gloss.text),
      pos: sense.pos,
      ...(sense.misc.length > 0 ? { misc: sense.misc } : {}),
      ...(sense.fields.length > 0 ? { fields: sense.fields } : {}),
      ...(sense.dialects.length > 0 ? { dialects: sense.dialects } : {}),
      ...(sense.info.length > 0 ? { info: sense.info } : {}),
      ...(sense.sources.length > 0 ? { sources: sense.sources } : {}),
      ...(sense.wasei ? { wasei: true } : {})
    }))
  }
}

/** The fixture's English word for a golden headword. */
export const goldenEnglishEntry = (entries: Iterable<EntryRecord>, headword: string): EntryRecord | undefined => {
  for (const entry of entries) if (entry.language === "en" && entry.headword === headword) return entry
  return undefined
}
