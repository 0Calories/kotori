import type { AgeGroup, Connotation, Currency, Formality, Gender, Keigo, Medium, RegisterShape } from "@kotori/domain"
import { romanize } from "@kotori/japanese"

/**
 * The golden set: words with known-correct judgments, seeded from failures caught in
 * production and padded with ordinary words as controls. `kotori eval nuance`
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
