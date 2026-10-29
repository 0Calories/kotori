import type {
  AgeGroup,
  Connotation,
  Currency,
  EnglishCurrency,
  EnglishRegister,
  EnglishStrength,
  EnglishVariety,
  Formality,
  Gender,
  Keigo,
  LoanVerdict,
  Medium,
  RegisterShape
} from "@kotori/domain"
import { romanize } from "@kotori/japanese"

/**
 * The golden set: words with known-correct judgments, seeded from failures caught in
 * production and padded with ordinary words as controls. `kotori eval nuance|english`
 * runs the current questions against it and reports per-question accuracy, so prompt
 * changes are measured here instead of spot-checked. Scale expectations list every
 * acceptable label (adjacent labels are often both defensible); boolean expectations
 * are judged at the display threshold (probability >= 0.6).
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
}

export interface GoldenSense {
  readonly word: string
  readonly reading: string
  readonly meaning: string
  readonly partOfSpeech?: ReadonlyArray<string>
  /** Dictionary-style usage notes fed to the state, as JMDict would provide. */
  readonly notes?: ReadonlyArray<string>
  readonly expect: GoldenExpectation
}

const g = (
  word: string,
  reading: string,
  meaning: string,
  expect: GoldenExpectation,
  extra: Partial<Pick<GoldenSense, "partOfSpeech" | "notes">> = {}
): GoldenSense => ({ word, reading, meaning, expect, ...extra })

export const GOLDEN_SENSES: ReadonlyArray<GoldenSense> = [
  // --- Vulgar and fixed-register words: the slider is the wrong model ---------
  g("てめえ", "てめえ", "you (hostile)", { formality: ["vulgar"], registerShape: "fixed", rudeToSuperiors: true }),
  g("くそ", "くそ", "damn; shit", { formality: ["vulgar"], registerShape: "fixed", rudeToSuperiors: true }),
  g("ぶっ殺す", "ぶっころす", "to beat to death; to kill", { formality: ["vulgar"], registerShape: "fixed" }),
  g("馬鹿", "ばか", "idiot; fool", {
    formality: ["vulgar", "casual"],
    connotation: "negative",
    rudeToSuperiors: true
  }),
  g("デブ", "デブ", "fatso; fat person", { formality: ["vulgar", "casual"], connotation: "negative" }),
  // --- Casual words and slang --------------------------------------------------
  g("めっちゃ", "めっちゃ", "very; extremely", {
    formality: ["casual"],
    medium: ["spoken"],
    rudeToSuperiors: true,
    stiffWithFriends: false
  }),
  g("やばい", "やばい", "dangerous; awesome", { formality: ["casual"], medium: ["spoken"], slang: true }),
  g("マジ", "マジ", "serious; really", { formality: ["casual"], medium: ["spoken"], slang: true, age: "youth" }),
  g("うまい", "うまい", "delicious; tasty", { formality: ["casual"], rudeToSuperiors: true }),
  g("食う", "くう", "to eat", { formality: ["casual", "vulgar"], rudeToSuperiors: true, gender: "masculine" }),
  g("飯", "めし", "meal; cooked rice", { formality: ["casual"], rudeToSuperiors: true }),
  g("うん", "うん", "yes; yeah", { formality: ["casual"], medium: ["spoken"], rudeToSuperiors: true }),
  g("でかい", "でかい", "huge; big", { formality: ["casual"], rudeToSuperiors: true }),
  g("ググる", "ググる", "to google", { formality: ["casual"], slang: true }),
  g("エモい", "エモい", "moving; nostalgic", { formality: ["casual"], slang: true, age: "youth", currency: "trendy" }),
  g("バイト", "バイト", "part-time job", { formality: ["casual", "neutral"], stiffWithFriends: false }),
  g("あんた", "あんた", "you", { formality: ["casual"], medium: ["spoken"], rudeToSuperiors: true }),
  g("お前", "おまえ", "you (familiar)", {
    formality: ["casual", "vulgar"],
    rudeToSuperiors: true,
    gender: "masculine"
  }),
  g("俺", "おれ", "I; me (masculine)", { formality: ["casual"], gender: "masculine", rudeToSuperiors: true }),
  g("あたし", "あたし", "I; me (feminine)", { formality: ["casual"], gender: "feminine", medium: ["spoken"] }),
  g("僕", "ぼく", "I; me (male, modest)", { formality: ["casual", "neutral"], gender: "masculine" }),
  g("やっぱり", "やっぱり", "as expected; after all", {
    formality: ["casual", "neutral"],
    medium: ["spoken"],
    rudeToSuperiors: false
  }),
  g("ちゃんと", "ちゃんと", "properly; exactly", { formality: ["casual", "neutral"], medium: ["spoken"] }),
  g("すごく", "すごく", "very; awfully", { formality: ["casual", "neutral"], rudeToSuperiors: false, slang: false }),
  // --- Neutral controls: nothing should fire -----------------------------------
  g("歩く", "あるく", "to walk", {
    formality: ["neutral"],
    medium: ["both"],
    registerShape: "scaled",
    rudeToSuperiors: false,
    stiffWithFriends: false,
    slang: false
  }),
  g("学校", "がっこう", "school", { formality: ["neutral"], medium: ["both"] }),
  g("時間", "じかん", "time; hour", { formality: ["neutral"], stiffWithFriends: false }),
  g("食べる", "たべる", "to eat", { formality: ["neutral"], rudeToSuperiors: false }),
  g("水", "みず", "water", { formality: ["neutral"], medium: ["both"] }),
  g("犬", "いぬ", "dog", { formality: ["neutral"] }),
  g("会社", "かいしゃ", "company; corporation", { formality: ["neutral"] }),
  g("行く", "いく", "to go", { formality: ["neutral"], rudeToSuperiors: false }),
  g("大きい", "おおきい", "big; large", { formality: ["neutral"], rudeToSuperiors: false }),
  g("分かる", "わかる", "to understand", { formality: ["neutral"], rudeToSuperiors: false }),
  g("美味しい", "おいしい", "delicious", { formality: ["neutral"], rudeToSuperiors: false }),
  g("見る", "みる", "to see; to look", { formality: ["neutral"], rudeToSuperiors: false }),
  g("死ぬ", "しぬ", "to die", { formality: ["neutral"], rudeToSuperiors: false }),
  g("素晴らしい", "すばらしい", "wonderful; splendid", { formality: ["neutral", "polite"], connotation: "positive" }),
  // --- Polite words and keigo ---------------------------------------------------
  g("お手洗い", "おてあらい", "bathroom; lavatory", { formality: ["polite"], rudeToSuperiors: false }),
  g("ございます", "ございます", "to be; to exist (polite)", {
    formality: ["polite", "formal"],
    keigo: "teineigo",
    stiffWithFriends: true
  }),
  g("よろしい", "よろしい", "good; fine (polite)", { formality: ["polite"] }),
  g("お茶", "おちゃ", "tea", { formality: ["neutral", "polite"], keigo: "bikago", stiffWithFriends: false }),
  g("ご飯", "ごはん", "cooked rice; meal", { formality: ["neutral"], keigo: "bikago", rudeToSuperiors: false }),
  g("召し上がる", "めしあがる", "to eat; to drink (honorific)", {
    formality: ["formal"],
    keigo: "sonkeigo",
    stiffWithFriends: true,
    rudeToSuperiors: false
  }),
  g("拝見する", "はいけんする", "to see; to look at (humble)", {
    formality: ["formal"],
    keigo: "kenjougo",
    stiffWithFriends: true,
    currency: "current"
  }),
  g("伺う", "うかがう", "to ask; to visit (humble)", { formality: ["formal", "polite"], keigo: "kenjougo" }),
  g("申す", "もうす", "to say; to be called (humble)", {
    formality: ["formal"],
    keigo: "kenjougo",
    stiffWithFriends: true
  }),
  g("いらっしゃる", "いらっしゃる", "to be; to come (honorific)", {
    formality: ["formal", "polite"],
    keigo: "sonkeigo"
  }),
  g("おっしゃる", "おっしゃる", "to say (honorific)", { formality: ["formal", "polite"], keigo: "sonkeigo" }),
  g("誠に", "まことに", "truly; sincerely", { formality: ["formal"], stiffWithFriends: true }),
  g("ご逝去", "ごせいきょ", "death (honorific)", { formality: ["formal"], registerShape: "fixed" }),
  g("恐縮", "きょうしゅく", "feeling obliged; grateful", {
    formality: ["formal"],
    currency: "current",
    age: "any",
    stiffWithFriends: true
  }),
  // --- Written and bookish words -------------------------------------------------
  g("鑑みる", "かんがみる", "to take into account; in view of", { medium: ["written"], stiffWithFriends: true }),
  g("及び", "および", "and; as well as", { medium: ["written"], stiffWithFriends: true }),
  g("当該", "とうがい", "the said; relevant", { medium: ["written"], stiffWithFriends: true }),
  g("遺憾", "いかん", "regrettable", { medium: ["written"], formality: ["formal", "neutral"] }),
  g("故に", "ゆえに", "therefore; consequently", { medium: ["written"], stiffWithFriends: true }),
  // --- Sneaky words: polite-looking but rude upward — the caution's whole point --
  g("了解", "りょうかい", "understood; roger", { rudeToSuperiors: true, stiffWithFriends: false }),
  g("ご苦労様", "ごくろうさま", "thanks for your trouble", { rudeToSuperiors: true }),
  g("お疲れ様", "おつかれさま", "thanks for your hard work", { formality: ["polite"], rudeToSuperiors: false }),
  // --- Delicate subjects: register, not subject (the SUBJECT_NOT_REGISTER guard) --
  g("妊娠", "にんしん", "pregnancy; conception", {
    formality: ["neutral"],
    medium: ["both"],
    registerShape: "scaled",
    stiffWithFriends: false
  }),
  g("勃起", "ぼっき", "erection", { formality: ["neutral"], registerShape: "split", stiffWithFriends: false }),
  g(
    "性交",
    "せいこう",
    "sexual intercourse",
    { medium: ["written"], stiffWithFriends: true },
    {
      notes: ["formal or medical term"]
    }
  ),
  g("セックス", "セックス", "sex; sexual intercourse", {
    formality: ["casual", "neutral"],
    stiffWithFriends: false
  }),
  g("おっぱい", "おっぱい", "boobs; breasts", { formality: ["casual"], rudeToSuperiors: true }),
  g("便秘", "べんぴ", "constipation", { formality: ["neutral"], stiffWithFriends: false }),
  g("生理", "せいり", "menstruation; period", { formality: ["neutral"], medium: ["both"] }),
  g("浣腸", "かんちょう", "enema", { formality: ["neutral"], registerShape: "split" }),
  g("うんこ", "うんこ", "poop", { formality: ["casual", "vulgar"], rudeToSuperiors: true }),
  g("トイレ", "トイレ", "toilet; bathroom", { formality: ["neutral"], stiffWithFriends: false }),
  // --- Gender, age and currency markers ------------------------------------------
  g("かしら", "かしら", "I wonder (sentence-ending)", { gender: "feminine", medium: ["spoken"] }),
  g("わんわん", "わんわん", "doggy; woof-woof", { age: "children", formality: ["casual"] }),
  g("おてて", "おてて", "hands (baby talk)", { age: "children" }),
  g("ハイカラ", "ハイカラ", "stylish; modern (old-fashioned)", { currency: "dated" }),
  g("ナウい", "ナウい", "trendy (1980s slang)", { currency: "dated", slang: true }),
  g("候", "そうろう", "to be (classical copula)", { currency: "archaic", medium: ["written"] }),
  g("汝", "なんじ", "thou; you (archaic)", { currency: "archaic" }),
  g("銀幕", "ぎんまく", "silver screen; cinema", { currency: "dated" })
]

/** The state `kotori eval nuance` sends for a golden sense, mirroring `senseState`. */
export const goldenState = (sense: GoldenSense) => ({
  word: sense.word,
  reading: `${sense.reading} (${romanize(sense.reading)})`,
  meaning: sense.meaning,
  part_of_speech: sense.partOfSpeech ?? [],
  dictionary_notes: sense.notes ?? [],
  other_meanings: []
})

// --- The English side ------------------------------------------------------------

export interface GoldenEnglishExpectation {
  readonly variety?: EnglishVariety
  readonly strength?: EnglishStrength
  readonly currency?: EnglishCurrency
  readonly register?: EnglishRegister
  readonly loan?: LoanVerdict
}

export interface GoldenEnglish {
  readonly word: string
  readonly meaning: string
  /** The Japanese word it translates, for the state's contrast field. */
  readonly japanese: string
  readonly reading: string
  readonly expect: GoldenEnglishExpectation
}

const e = (
  word: string,
  meaning: string,
  japanese: string,
  reading: string,
  expect: GoldenEnglishExpectation
): GoldenEnglish => ({ word, meaning, japanese, reading, expect })

export const GOLDEN_ENGLISH: ReadonlyArray<GoldenEnglish> = [
  // --- Loanword false friends: the スタイル problem; precision here is the feature --
  e("style", "style; manner", "様式", "ようしき", { loan: "diverges" }),
  e("mansion", "mansion; stately home", "大邸宅", "だいていたく", { loan: "diverges" }),
  e("tension", "tension; strain", "緊張", "きんちょう", { loan: "diverges" }),
  e("naive", "naive; credulous", "世間知らず", "せけんしらず", { loan: "diverges" }),
  e("smart", "intelligent; clever", "賢い", "かしこい", { loan: "diverges" }),
  e("cunning", "cunning; sly", "ずるい", "ずるい", { loan: "diverges" }),
  e("claim", "to claim; to assert", "主張する", "しゅちょうする", { loan: "diverges" }),
  e("talent", "talent; gift", "才能", "さいのう", { loan: "diverges" }),
  e("juice", "juice (squeezed from fruit)", "果汁", "かじゅう", { loan: "diverges" }),
  e("bike", "bicycle", "自転車", "じてんしゃ", { loan: "diverges" }),
  e("seal", "seal (animal); to seal", "封", "ふう", { loan: "diverges" }),
  // --- Loans that match: instant comprehension, shown quietly -----------------------
  e("table", "table (furniture)", "机", "つくえ", { loan: "matches" }),
  e("coffee", "coffee", "珈琲", "コーヒー", { loan: "matches" }),
  e("camera", "camera", "写真機", "しゃしんき", { loan: "matches" }),
  e("computer", "computer", "計算機", "けいさんき", { loan: "matches" }),
  e("door", "door", "扉", "とびら", { loan: "matches" }),
  e("hotel", "hotel", "宿", "やど", { loan: "matches" }),
  // --- No common loan ----------------------------------------------------------------
  e("walk", "to walk", "歩く", "あるく", { loan: "no_loan" }),
  e("borrow", "to borrow", "借りる", "かりる", { loan: "no_loan" }),
  e("shallow", "shallow", "浅い", "あさい", { loan: "no_loan" }),
  // --- Strength tiers -----------------------------------------------------------------
  e("fuck", "to have sex; damn it", "くそ", "くそ", { strength: "strong" }),
  e("shit", "feces; damn", "くそ", "くそ", { strength: "strong" }),
  e("damn", "damn; darn", "ちくしょう", "ちくしょう", { strength: "mild" }),
  e("crap", "junk; nonsense", "がらくた", "がらくた", { strength: "mild" }),
  e("eat", "to eat", "食べる", "たべる", { strength: "none" }),
  // --- Currency and register -----------------------------------------------------------
  e("whom", "whom (object of a verb)", "誰を", "だれを", { currency: "dated", register: "formal" }),
  e("How do you do?", "how do you do (greeting)", "初めまして", "はじめまして", { currency: "textbook" }),
  e("wanna", "want to (colloquial)", "〜したい", "したい", { register: "casual", currency: "current" }),
  e("purchase", "to purchase; to buy", "購入する", "こうにゅうする", { register: "formal" }),
  e("commence", "to commence; to begin", "開始する", "かいしする", { register: "formal" }),
  e("kids", "children", "子供", "こども", { register: "casual" }),
  // --- Regional variety ----------------------------------------------------------------
  e("lift", "elevator", "エレベーター", "エレベーター", { variety: "british" }),
  e("flat", "apartment", "アパート", "アパート", { variety: "british" }),
  e("fall", "autumn", "秋", "あき", { variety: "american" }),
  e("soccer", "association football", "サッカー", "サッカー", { variety: "american" }),
  e("lorry", "truck", "トラック", "トラック", { variety: "british" }),
  e("candy", "sweets", "飴", "あめ", { variety: "american" })
]

/** The state `kotori eval english` sends for a golden English word, mirroring the sense state. */
export const goldenEnglishState = (item: GoldenEnglish) => ({
  word: item.japanese,
  reading: item.reading,
  meaning: item.meaning,
  english_word: item.word
})
