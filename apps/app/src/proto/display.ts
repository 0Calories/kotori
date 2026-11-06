/**
 * PROTOTYPE. How the proposed model reads on the page: label names, their severity and
 * explanation, pitfall kinds, the usage chips, and the similar-word difference derived from two
 * words' labels instead of asked of a model. Interface copy is in the learner's language: English
 * on Japanese words, Japanese on English ones.
 */
import type { IconName } from "../components/Icon.tsx"
import type { Entry, Label, LabelCode, Language, PitfallKind, Sense, Source } from "./model.ts"

/**
 * How loudly a label chip speaks. `quiet` is a grammar fact (uncountable, idiom); `info` is a
 * register the learner wants to know but needn't fear (keigo, a region); `caution` can misfire
 * (casual, gendered, dated); `avoid` means don't use it (vulgar, archaic).
 */
export type Severity = "quiet" | "info" | "caution" | "avoid"

export const severity: Record<LabelCode, Severity> = {
  vulg: "avoid",
  X: "avoid",
  derog: "avoid",
  arch: "avoid",
  obs: "avoid",
  col: "caution",
  sl: "caution",
  "net-sl": "caution",
  fam: "caution",
  male: "caution",
  fem: "caution",
  chn: "caution",
  dated: "caution",
  hist: "caution",
  rare: "caution",
  joc: "caution",
  hon: "info",
  hum: "info",
  pol: "info",
  form: "info",
  poet: "info",
  euph: "info",
  "en-US": "info",
  "en-GB": "info",
  "en-AU": "info",
  ksb: "info",
  wasei: "info",
  id: "quiet",
  "on-mim": "quiet",
  abbr: "quiet",
  uncountable: "quiet"
}

export interface ProtoStrings {
  readonly labels: Record<LabelCode, string>
  /** One sentence behind each chip, shown on tap or hover. */
  readonly labelHelp: Record<LabelCode, string>
  readonly pitfall: Record<PitfallKind, string>
  readonly source: Record<Source, string>
  readonly watchOut: string
  readonly meaning: string
  readonly meanings: string
  readonly similar: string
  readonly similarIntro: (word: string) => string
  readonly difference: {
    readonly casual: string
    readonly formal: string
    readonly respectful: string
    readonly humble: string
    readonly american: string
    readonly british: string
    readonly dated: string
    readonly same: string
  }
  readonly commonWord: string
  readonly commonHelp: string
  readonly rareWord: string
  readonly rareHelp: string
  readonly usuallyKana: string
  readonly forms: string
  readonly inflections: string
  readonly from: (word: string) => string
  readonly fromSame: (word: string) => string
  readonly fromDiverged: (word: string) => string
  readonly loanSame: (word: string) => string
  readonly loanSameHelp: string
  readonly byKotori: string
  readonly byKotoriHelp: string
  readonly legendKotori: string
  readonly compare: string
  readonly dictionaryOnly: string
  readonly dictionaryOnlyBody: (word: string) => string
  readonly ask: string
  readonly sources: string
  readonly sourceLine: (parts: ReadonlyArray<string>) => string
  readonly showData: string
  readonly hideData: string
  readonly listen: string
  readonly more: string
  readonly less: string
}

const en: ProtoStrings = {
  labels: {
    col: "Casual",
    sl: "Slang",
    "net-sl": "Internet slang",
    fam: "Familiar",
    vulg: "Vulgar",
    X: "Offensive",
    derog: "Derogatory",
    joc: "Jocular",
    euph: "Euphemism",
    hon: "Respectful (尊敬語)",
    hum: "Humble (謙譲語)",
    pol: "Polite (丁寧語)",
    form: "Formal, written",
    poet: "Poetic",
    male: "Masculine",
    fem: "Feminine",
    chn: "Children's",
    arch: "Archaic",
    obs: "Obsolete",
    dated: "Dated",
    hist: "Historical",
    rare: "Rare",
    id: "Idiom",
    "on-mim": "Onomatopoeia",
    abbr: "Abbreviation",
    wasei: "Wasei-eigo",
    uncountable: "Uncountable",
    "en-US": "American",
    "en-GB": "British",
    "en-AU": "Australian",
    ksb: "Kansai"
  },
  labelHelp: {
    col: "Everyday conversational wording. Fine with friends and family; too relaxed for a boss or a stranger.",
    sl: "Slang. Natural among friends, out of place in anything formal.",
    "net-sl": "Internet slang. Mostly typed, mostly by younger people.",
    fam: "Familiar wording for people you are close to.",
    vulg: "Crude. It offends strangers and superiors; use it only if you know exactly what you are doing.",
    X: "Offensive to a group of people. A learner should not use it.",
    derog: "Said to belittle someone. Hostile in almost any setting.",
    joc: "Said in jest; it sounds odd when meant seriously.",
    euph: "A softer way of saying something blunt.",
    hon: "Respectful language: it elevates someone else's action. Never about yourself.",
    hum: "Humble language: it lowers your own action. Never about someone you respect.",
    pol: "Polite language that fits strangers, customers and superiors.",
    form: "Formal, written wording: documents, speeches, announcements. Stiff in conversation.",
    poet: "Literary or poetic. Rare in speech.",
    male: "Mostly said by men. From a woman it sounds rough or deliberate.",
    fem: "Mostly said by women. From a man it sounds like a put-on.",
    chn: "Children's language, or how adults talk to small children.",
    arch: "Archaic: found in old texts and period drama, not in modern use. Recognise it; don't say it.",
    obs: "Obsolete: no longer used at all.",
    dated: "Understood, but old-fashioned. It dates the speaker.",
    hist: "A historical term for something that no longer exists.",
    rare: "Rarely used, even by natives.",
    id: "An idiom: the meaning isn't the sum of its words.",
    "on-mim": "A sound or mimetic word.",
    abbr: "An abbreviation of a longer word.",
    wasei: "English-looking, but coined in Japan. English speakers won't recognise it.",
    uncountable: "Uncountable: no plural, no 'a'. Use 'some' or 'a piece of'.",
    "en-US": "Chiefly American English.",
    "en-GB": "Chiefly British English.",
    "en-AU": "Chiefly Australian English.",
    ksb: "Kansai dialect: Osaka, Kyoto, Kobe. Standard Japanese says it differently."
  },
  pitfall: {
    rude_upward: "Sounds rude upward",
    keigo_direction: "Keigo direction",
    set_phrase: "Set phrase",
    particle_pattern: "Particle",
    gendered_speech: "Gendered speech",
    false_friend: "False friend",
    textbook_english: "Textbook English",
    directness: "Directness",
    variety: "Variety",
    confusable: "Easily confused",
    collocation: "Collocation"
  },
  source: {
    jmdict: "JMDict",
    jawiktionary: "Japanese Wiktionary",
    enwiktionary: "Wiktionary",
    tatoeba: "Tatoeba",
    kotori: "Kotori",
    user: "a learner"
  },
  watchOut: "Watch out",
  meaning: "Meaning",
  meanings: "Meanings",
  similar: "Similar words",
  similarIntro: (word) => `Words close to ${word}, and how each differs.`,
  difference: {
    casual: "more casual",
    formal: "more formal",
    respectful: "the respectful form",
    humble: "the humble form",
    american: "the American word",
    british: "the British word",
    dated: "older-sounding",
    same: "similar meaning"
  },
  commonWord: "Common word",
  commonHelp: "On the dictionary's list of basic vocabulary. You will meet it often.",
  rareWord: "Rarely heard today",
  rareHelp: "Natives recognise it but seldom say it. Worth knowing; not worth memorising.",
  usuallyKana: "usually written in kana",
  forms: "Also written",
  inflections: "Forms",
  from: (word) => `from English “${word}”`,
  fromSame: (word) => `from English “${word}”, same meaning`,
  fromDiverged: (word) => `from English “${word}”, but not what “${word}” means`,
  loanSame: (word) => `Same as 「${word}」`,
  loanSameHelp: "The katakana loan means the same thing as this word.",
  byKotori: "Added by Kotori",
  byKotoriHelp: "The dictionary didn't mark this. Kotori's AI judged it from how the word is used.",
  legendKotori: "✦ marks a label or note added by Kotori's AI, not taken from the dictionary.",
  compare: "Compare",
  dictionaryOnly: "Nothing from Kotori yet",
  dictionaryOnlyBody: (word) =>
    `${word} is here from the dictionary alone. Ask and Kotori will write examples and notes for it.`,
  ask: "Ask Kotori",
  sources: "Sources",
  sourceLine: (parts) => parts.join(" · "),
  showData: "Show the data behind this page",
  hideData: "Hide the data",
  listen: "Listen",
  more: "More",
  less: "Less"
}

const ja: ProtoStrings = {
  labels: {
    col: "口語",
    sl: "俗語",
    "net-sl": "ネットスラング",
    fam: "くだけた言い方",
    vulg: "卑語",
    X: "差別的・侮辱的",
    derog: "軽蔑的",
    joc: "おどけた言い方",
    euph: "婉曲",
    hon: "尊敬語",
    hum: "謙譲語",
    pol: "丁寧語",
    form: "改まった表現・書き言葉",
    poet: "詩語",
    male: "男性語",
    fem: "女性語",
    chn: "幼児語",
    arch: "古語",
    obs: "廃語",
    dated: "古風",
    hist: "歴史用語",
    rare: "まれ",
    id: "慣用句",
    "on-mim": "擬音語・擬態語",
    abbr: "略語",
    wasei: "和製英語",
    uncountable: "不可算",
    "en-US": "アメリカ英語",
    "en-GB": "イギリス英語",
    "en-AU": "オーストラリア英語",
    ksb: "関西弁"
  },
  labelHelp: {
    col: "日常会話の言い方です。友人や家族には自然ですが、上司や初対面の人にはくだけすぎます。",
    sl: "俗語です。友人同士では自然ですが、改まった場では使いません。",
    "net-sl": "ネット発祥の俗語。主に若い人が文字で使います。",
    fam: "親しい相手に使うくだけた言い方です。",
    vulg: "下品な言葉です。初対面の人や目上の人を不快にさせます。",
    X: "特定の人々を傷つける言葉です。学習者は使わないでください。",
    derog: "人を見下す言い方です。ほぼどんな場面でも敵意に聞こえます。",
    joc: "冗談めかした言い方。真面目に使うと変に聞こえます。",
    euph: "直接的な表現を和らげた言い方です。",
    hon: "相手の動作を高める言い方です。",
    hum: "自分の動作をへりくだる言い方です。",
    pol: "初対面の人や目上の人に使える丁寧な言い方です。",
    form: "書類・スピーチ・告知などの改まった言い方。会話では堅く聞こえます。",
    poet: "文学的・詩的な言葉。会話ではまず使いません。",
    male: "主に男性が使います。",
    fem: "主に女性が使います。",
    chn: "子どもの言葉、または子どもに話しかけるときの言葉です。",
    arch: "古語です。古い文献や時代劇で見かけますが、現代では使いません。読めればよく、話す必要はありません。",
    obs: "廃れた言葉で、現在は使われません。",
    dated: "通じますが古めかしく、使うと年齢を感じさせます。",
    hist: "今は存在しないものを指す歴史用語です。",
    rare: "ネイティブでもめったに使いません。",
    id: "慣用句。単語の意味を足しても意味は出てきません。",
    "on-mim": "擬音語・擬態語です。",
    abbr: "長い語の省略形です。",
    wasei: "英語に見えますが日本で作られた語で、英語話者には通じません。",
    uncountable:
      "数えられない名詞。複数形も a も付けません。an advice ではなく some advice、a piece of advice と言います。",
    "en-US": "主にアメリカ英語で使われます。",
    "en-GB": "主にイギリス英語で使われます。",
    "en-AU": "主にオーストラリア英語で使われます。",
    ksb: "関西弁です。"
  },
  pitfall: {
    rude_upward: "目上には失礼",
    keigo_direction: "敬語の向き",
    set_phrase: "決まり文句",
    particle_pattern: "助詞",
    gendered_speech: "性別の響き",
    false_friend: "カタカナ語とのずれ",
    textbook_english: "教科書英語",
    directness: "直接さの感覚",
    variety: "地域差",
    confusable: "混同しやすい",
    collocation: "よくある組み合わせ"
  },
  source: {
    jmdict: "JMDict",
    jawiktionary: "日本語版ウィクショナリー",
    enwiktionary: "Wiktionary",
    tatoeba: "Tatoeba",
    kotori: "Kotori",
    user: "学習者"
  },
  watchOut: "ここに注意",
  meaning: "意味",
  meanings: "意味",
  similar: "似た言葉",
  similarIntro: (word) => `${word} に近い言葉と、それぞれの違いです。`,
  difference: {
    casual: "よりくだけた",
    formal: "より改まった",
    respectful: "尊敬語",
    humble: "謙譲語",
    american: "アメリカの言い方",
    british: "イギリスの言い方",
    dated: "古風な響き",
    same: "近い意味"
  },
  commonWord: "よく使う言葉",
  commonHelp: "会話で頻繁に使われる基本語です。",
  rareWord: "今はあまり聞かない",
  rareHelp: "ネイティブは知っていますが、ほとんど口にしません。知っておけば十分です。",
  usuallyKana: "ふつう仮名書き",
  forms: "ほかの綴り",
  inflections: "活用形",
  from: (word) => `カタカナ語「${word}」`,
  fromSame: (word) => `カタカナ語「${word}」と同じ意味`,
  fromDiverged: (word) => `カタカナ語「${word}」とは意味が違う`,
  loanSame: (word) => `「${word}」と同じ意味`,
  loanSameHelp: "カタカナ語の意味のまま使えます。",
  byKotori: "Kotori が追加",
  byKotoriHelp: "辞書にはない情報です。Kotori の AI が使われ方から判断しました。",
  legendKotori: "✦ は辞書ではなく Kotori の AI が付けたラベルや注記です。",
  compare: "比べる",
  dictionaryOnly: "Kotori の情報はまだありません",
  dictionaryOnlyBody: (word) => `${word} は辞書のデータだけです。頼めば Kotori が例文と解説を書きます。`,
  ask: "Kotori に頼む",
  sources: "出典",
  sourceLine: (parts) => parts.join("・"),
  showData: "このページのデータを見る",
  hideData: "データを隠す",
  listen: "聞く",
  more: "もっと見る",
  less: "閉じる"
}

/** Interface copy for an entry: the learner's language is the one the headword isn't in. */
export const stringsFor = (language: Language): ProtoStrings => (language === "ja" ? en : ja)

export const pitfallIcon: Record<PitfallKind, IconName> = {
  rude_upward: "work_off",
  keigo_direction: "swap_horiz",
  set_phrase: "forum",
  particle_pattern: "spellcheck",
  gendered_speech: "person",
  false_friend: "error",
  textbook_english: "menu_book",
  directness: "forum",
  variety: "call_split",
  confusable: "call_split",
  collocation: "link"
}

/** Labels that make a word sound rough or casual, from most to least marked. */
const CASUAL: ReadonlyArray<LabelCode> = ["vulg", "X", "derog", "sl", "net-sl", "col", "fam"]
const FORMAL: ReadonlyArray<LabelCode> = ["form", "pol"]
const OLD: ReadonlyArray<LabelCode> = ["arch", "obs", "dated"]

const has = (labels: ReadonlyArray<Label>, codes: ReadonlyArray<LabelCode>) =>
  labels.some((label) => codes.includes(label.code))

/**
 * How `other` differs from `own`, read off their labels. No model is asked: two words that share
 * a gloss and differ in a register label differ in that register. Words with the same labels are
 * just "similar meaning".
 */
export const derivedDifference = (t: ProtoStrings, own: ReadonlyArray<Label>, other: ReadonlyArray<Label>): string => {
  if (has(other, ["hon"]) && !has(own, ["hon"])) return t.difference.respectful
  if (has(other, ["hum"]) && !has(own, ["hum"])) return t.difference.humble
  if (has(other, CASUAL) && !has(own, CASUAL)) return t.difference.casual
  if (has(other, FORMAL) && !has(own, FORMAL)) return t.difference.formal
  if (has(own, CASUAL) && !has(other, CASUAL)) return t.difference.formal
  if (has(own, FORMAL) && !has(other, FORMAL)) return t.difference.casual
  if (has(other, ["en-US"]) && !has(own, ["en-US"])) return t.difference.american
  if (has(other, ["en-GB"]) && !has(own, ["en-GB"])) return t.difference.british
  if (has(other, OLD) && !has(own, OLD)) return t.difference.dated
  return t.difference.same
}

/** A chip in the hero that is not a label: usage evidence, or the katakana loan agreeing. */
export interface HeroChip {
  readonly key: string
  readonly label: string
  readonly help: string
  readonly severity: Severity
  readonly icon?: IconName
}

/**
 * What the seeds say about how much the word is used, as a chip: "common" is reassurance a learner
 * wants to see, "rarely heard" is the surprise. Nothing in between is said.
 */
export const usageChip = (t: ProtoStrings, entry: Entry): HeroChip | null => {
  const { everyday, spokenCount, familiarity } = entry.evidence
  const archaic = entry.senses[0]?.labels.some((label) => OLD.includes(label.code)) ?? false
  if ((familiarity !== null && familiarity <= 2) || archaic) {
    return { key: "rare", label: t.rareWord, help: t.rareHelp, severity: "caution" }
  }
  if (everyday || (spokenCount !== null && spokenCount >= 5_000) || entry.common) {
    return { key: "common", label: t.commonWord, help: t.commonHelp, severity: "info", icon: "check_circle" }
  }
  return null
}

/** On an English word whose katakana loan kept its meaning, say so; drift is a pitfall instead. */
export const loanChip = (t: ProtoStrings, entry: Entry): HeroChip | null =>
  entry.language === "en" && entry.loan !== null && entry.loan.meaning === "same"
    ? { key: "loan", label: t.loanSame(entry.loan.katakana), help: t.loanSameHelp, severity: "info", icon: "check" }
    : null

/** The word's labels: its first sense's. A sense shows its own only where they differ. */
export const wordLabels = (entry: Entry): ReadonlyArray<Label> => entry.senses[0]?.labels ?? []

export const ownLabels = (entry: Entry, sense: Sense): ReadonlyArray<Label> => {
  const word = new Set(wordLabels(entry).map((label) => label.code))
  return sense.index === 0 ? [] : sense.labels.filter((label) => !word.has(label.code))
}

/** Whether anything on the page carries Kotori's mark, so the legend is shown. */
export const hasKotoriMarks = (entry: Entry): boolean =>
  entry.senses.some(
    (sense) =>
      sense.labels.some((label) => label.source === "kotori") ||
      sense.patterns.some((pattern) => pattern.source === "kotori")
  )

/** Who contributed to this page, for the sources line. */
export const contributors = (t: ProtoStrings, entry: Entry): ReadonlyArray<string> => {
  const sources = new Set<Source>([entry.dictionary])
  for (const sense of entry.senses) {
    for (const label of sense.labels) sources.add(label.source)
    for (const pattern of sense.patterns) sources.add(pattern.source)
    for (const example of sense.examples) sources.add(example.source)
  }
  for (const pitfall of entry.pitfalls) sources.add(pitfall.source)
  if (entry.loan) sources.add(entry.loan.source)
  return [...sources].map((source) => t.source[source])
}
