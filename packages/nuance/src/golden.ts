import type { EntryRecord } from "@kotori/db"
import type {
  AgeGroup,
  Connotation,
  Currency,
  Difference,
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
import { Schema } from "effect"

/**
 * The golden set: dictionary senses with known-correct judgments, seeded from failures caught
 * in production and padded with ordinary words as controls. Each names a real JMDict entry
 * and sense, and `kotori eval nuance|english` builds its request from that entry with the
 * production builders and interprets the answers with the entry's own tags, so it measures
 * what learners are shown. The entries come from `GOLDEN_FIXTURE`, cut from the JMDict
 * download by `tools/golden-fixture.ts`. Scale expectations list every acceptable label
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

// --- The English side ------------------------------------------------------------

export interface GoldenEnglishExpectation {
  readonly variety?: EnglishVariety
  readonly strength?: EnglishStrength
  readonly currency?: EnglishCurrency
  readonly register?: EnglishRegister
  readonly loan?: LoanVerdict
  /** The katakana loan a `matches` or `diverges` verdict is about, as the dictionary spells it. */
  readonly loanWord?: string
}

/** One English gloss of a Japanese sense, as Japanese natives see it. */
export interface GoldenEnglish {
  /** The English word judged: one of the sense's first glosses, as JMDict writes it. */
  readonly english: string
  /** The Japanese word it translates, for reports; one of the entry's forms. */
  readonly word: string
  readonly entryId: number
  readonly sense: number
  readonly expect: GoldenEnglishExpectation
}

const e = (
  english: string,
  word: string,
  entryId: number,
  sense: number,
  expect: GoldenEnglishExpectation
): GoldenEnglish => ({ english, word, entryId, sense, expect })

export const GOLDEN_ENGLISH: ReadonlyArray<GoldenEnglish> = [
  // --- Loanword false friends: the スタイル problem; precision here is the feature --
  e("style", "様式", 1545830, 0, { loan: "diverges", loanWord: "スタイル" }),
  e("mansion", "大邸宅", 2079220, 0, { loan: "diverges", loanWord: "マンション" }),
  e("tension", "緊張", 1241880, 0, { loan: "diverges", loanWord: "テンション" }),
  e("naive", "甘い", 1213400, 4, { loan: "diverges", loanWord: "ナイーブ" }),
  e("smart", "賢い", 1260260, 0, { loan: "diverges", loanWord: "スマート" }),
  e("cunning", "ずるい", 1569240, 0, { loan: "diverges", loanWord: "カンニング" }),
  e("claim", "主張", 1325910, 0, { loan: "diverges", loanWord: "クレーム" }),
  e("talent", "才能", 1294630, 0, { loan: "diverges", loanWord: "タレント" }),
  e("juice", "汁", 1335520, 0, { loan: "diverges", loanWord: "ジュース" }),
  e("bike", "自転車", 1318290, 0, { loan: "diverges", loanWord: "バイク" }),
  e("seal", "封", 1499580, 0, { loan: "diverges", loanWord: "シール" }),
  // --- Loans that match: instant comprehension, shown quietly -----------------------
  e("table", "卓", 1415580, 0, { loan: "matches", loanWord: "テーブル" }),
  // The katakana entry itself: the English page for "coffee" lists コーヒー.
  e("coffee", "コーヒー", 1049180, 0, { loan: "matches", loanWord: "コーヒー" }),
  e("camera", "写真機", 1594660, 0, { loan: "matches", loanWord: "カメラ" }),
  e("computer", "計算機", 1592560, 1, { loan: "matches", loanWord: "コンピュータ" }),
  e("door", "扉", 1483380, 0, { loan: "matches", loanWord: "ドア" }),
  e("hotel", "宿", 1337190, 0, { loan: "matches", loanWord: "ホテル" }),
  // --- No common loan ----------------------------------------------------------------
  e("walk", "歩く", 1514320, 0, { loan: "no_loan" }),
  e("borrow", "借りる", 1323560, 0, { loan: "no_loan" }),
  e("shallow", "浅い", 1390800, 0, { loan: "no_loan" }),
  // --- Strength tiers -----------------------------------------------------------------
  e("fuck", "はめる", 1566420, 5, { strength: "strong" }),
  e("shit", "くそ", 1504900, 0, { strength: "strong" }),
  e("damn", "ちくしょう", 1422200, 0, { strength: "mild" }),
  e("crap", "うんこ", 1001100, 1, { strength: "mild" }),
  e("eat", "食べる", 1358280, 0, { strength: "none" }),
  // --- Currency and register -----------------------------------------------------------
  e("motorcar", "自動車", 1318400, 0, { currency: "dated" }),
  e("how do you do?", "はじめまして", 1625780, 0, { currency: "textbook" }),
  e("guy", "やつ", 1445640, 0, { register: "casual", currency: "current" }),
  e("purchase", "購入", 1282440, 0, { register: "formal" }),
  e("commence", "始める", 1307550, 0, { register: "formal" }),
  e("kids", "子供たち", 1307870, 0, { register: "casual" }),
  // --- Regional variety ----------------------------------------------------------------
  e("lift", "エレベーター", 1030630, 0, { variety: "british" }),
  e("flat", "部屋", 1499320, 1, { variety: "british" }),
  e("fall", "秋", 1332650, 0, { variety: "american" }),
  e("soccer", "サッカー", 1056700, 0, { variety: "american" }),
  e("lorry", "トラック", 1085760, 0, { variety: "british" }),
  e("candy", "飴", 1153520, 0, { variety: "american" })
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
  headword: Schema.String,
  reading: Schema.String,
  common: Schema.Boolean,
  kanji: Codes,
  kana: Schema.Array(Schema.String),
  senses: Schema.Array(FixtureSense)
})
export type FixtureEntry = typeof FixtureEntry.Type

/**
 * A golden English word's katakana loan candidates, as the dictionary lookup finds them
 * (`loanCandidatesIn`): by gloss alone, as production does until JMDict is re-imported with
 * `lsource`, and by gloss or source, as it does after.
 */
const FixtureCandidate = Schema.Struct({ entryId: Schema.Int, by: Schema.Literals(["gloss", "source"]) })
const FixtureLoans = Schema.Struct({
  glossesOnly: Schema.Array(FixtureCandidate),
  withSources: Schema.Array(FixtureCandidate)
})

/** The JMDict entries the golden set names, as `tools/golden-fixture.ts` cuts them from the dictionary. */
export const GoldenFixture = Schema.Struct({
  about: Schema.String,
  /** Labels of the tag codes the entries use, as JMDict declares them. */
  tags: Schema.Record(Schema.String, Schema.String),
  entries: Schema.Array(FixtureEntry),
  /** Per golden English word (normalised), its katakana candidates, most frequent first. */
  loans: Schema.Record(Schema.String, FixtureLoans)
})
export type GoldenFixture = typeof GoldenFixture.Type

/** A fixture entry as the dictionary would return it; what the builders don't read is left empty. */
export const goldenEntry = (entry: FixtureEntry): EntryRecord => {
  const form = (kind: "kanji" | "kana") => (text: string) => ({
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
    headword: entry.headword,
    reading: entry.reading,
    common: entry.common,
    priority: 0,
    forms: [...(entry.kanji ?? []).map(form("kanji")), ...entry.kana.map(form("kana"))],
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
  const kanji = entry.forms.filter((form) => form.kind === "kanji").map((form) => form.text)
  return {
    id: entry.id,
    headword: entry.headword,
    reading: entry.reading,
    common: entry.common,
    ...(kanji.length > 0 ? { kanji } : {}),
    kana: entry.forms.filter((form) => form.kind === "kana").map((form) => form.text),
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
