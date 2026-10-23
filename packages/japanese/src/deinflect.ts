/**
 * Turns conjugated verbs and adjectives back into dictionary forms, so learners
 * can look up what they actually read or hear: 食べなかった -> 食べる.
 *
 * Works like Yomichan's deinflector: each rule rewrites a suffix and records the
 * grammatical type of the result. Rules chain (食べています -> 食べている -> 食べて
 * -> 食べる) and the dictionary lookup keeps only entries whose part of speech
 * fits the final type.
 */

/** Grammatical types a deinflected term can have. `iru` marks a て-form that came from ている. */
export type WordType = "v1" | "v5" | "vk" | "vs" | "vs-noun" | "adj-i" | "iru"

export type Inflection =
  | "polite"
  | "negative"
  | "past"
  | "te"
  | "progressive"
  | "potential"
  | "passive"
  | "causative"
  | "volitional"
  | "imperative"
  | "conditional"
  | "tari"
  | "want"
  | "adverb"
  | "noun"
  | "seems"
  | "too-much"
  | "completed"
  | "suru"

interface Rule {
  readonly from: string
  readonly to: string
  /** Types the inflected word must have; empty means it can only be the original input. */
  readonly inTypes: ReadonlyArray<WordType>
  readonly outType: WordType
  readonly reason: Inflection
}

export interface Deinflection {
  readonly term: string
  /** Null for the query itself, which may be any kind of word. */
  readonly type: WordType | null
  /** Inflections undone to reach the term, outermost last ("polite", "past"). */
  readonly reasons: ReadonlyArray<Inflection>
}

const rule = (
  from: string,
  to: string,
  inTypes: ReadonlyArray<WordType>,
  outType: WordType,
  reason: Inflection
): Rule => ({ from, to, inTypes, outType, reason })

/** Godan rows: dictionary ending, a/i/e/o stems, て-form and た-form endings. */
const GODAN = [
  ["う", "わ", "い", "え", "お", "って", "った"],
  ["く", "か", "き", "け", "こ", "いて", "いた"],
  ["ぐ", "が", "ぎ", "げ", "ご", "いで", "いだ"],
  ["す", "さ", "し", "せ", "そ", "して", "した"],
  ["つ", "た", "ち", "て", "と", "って", "った"],
  ["ぬ", "な", "に", "ね", "の", "んで", "んだ"],
  ["ぶ", "ば", "び", "べ", "ぼ", "んで", "んだ"],
  ["む", "ま", "み", "め", "も", "んで", "んだ"],
  ["る", "ら", "り", "れ", "ろ", "って", "った"]
] as const

/** Conjugations shared by every verb class, keyed by the stem each one attaches to. */
const verbRules = (
  type: "v1" | "v5" | "vk" | "vs",
  dict: string,
  stems: {
    readonly a: string
    readonly i: string
    readonly e: string
    readonly o: string
    readonly te: string
    readonly ta: string
  }
): Array<Rule> => [
  rule(`${stems.i}ます`, dict, [], type, "polite"),
  rule(`${stems.i}ません`, dict, [], type, "polite"),
  rule(`${stems.i}ました`, dict, [], type, "polite"),
  rule(`${stems.i}ませんでした`, dict, [], type, "polite"),
  rule(`${stems.i}ましょう`, dict, [], type, "polite"),
  rule(`${stems.a}ない`, dict, ["adj-i"], type, "negative"),
  rule(`${stems.a}ず`, dict, [], type, "negative"),
  rule(stems.ta, dict, [], type, "past"),
  rule(stems.te, dict, ["iru"], type, "te"),
  rule(`${stems.ta}ら`, dict, [], type, "conditional"),
  rule(`${stems.ta}り`, dict, [], type, "tari"),
  rule(`${stems.i}たい`, dict, ["adj-i"], type, "want")
]

const ichidan: Array<Rule> = [
  ...verbRules("v1", "る", { a: "", i: "", e: "", o: "", te: "て", ta: "た" }),
  rule("れば", "る", [], "v1", "conditional"),
  rule("よう", "る", [], "v1", "volitional"),
  rule("ろ", "る", [], "v1", "imperative"),
  rule("られる", "る", ["v1"], "v1", "passive"),
  rule("させる", "る", ["v1"], "v1", "causative"),
  rule("ちゃう", "る", ["v5"], "v1", "completed")
]

const godan: Array<Rule> = GODAN.flatMap(([dict, a, i, e, o, te, ta]) => [
  ...verbRules("v5", dict, { a, i, e, o, te, ta }),
  rule(`${e}ば`, dict, [], "v5", "conditional"),
  rule(`${o}う`, dict, [], "v5", "volitional"),
  rule(e, dict, [], "v5", "imperative"),
  rule(`${e}る`, dict, ["v1"], "v5", "potential"),
  rule(`${a}れる`, dict, ["v1"], "v5", "passive"),
  rule(`${a}せる`, dict, ["v1"], "v5", "causative"),
  rule(`${te.slice(0, -1)}${te.endsWith("で") ? "じゃう" : "ちゃう"}`, dict, ["v5"], "v5", "completed")
])

// 行く is the one godan verb with an irregular て/た-form.
const iku: Array<Rule> = ["行", "い"].flatMap((stem) => [
  rule(`${stem}って`, `${stem}く`, ["iru"], "v5", "te"),
  rule(`${stem}った`, `${stem}く`, [], "v5", "past"),
  rule(`${stem}ったら`, `${stem}く`, [], "v5", "conditional")
])

const kuru: Array<Rule> = [
  ...verbRules("vk", "来る", { a: "来", i: "来", e: "来", o: "来", te: "来て", ta: "来た" }),
  ...verbRules("vk", "くる", { a: "こ", i: "き", e: "く", o: "こ", te: "きて", ta: "きた" }),
  ...["来", "こ"].flatMap((stem) => [
    rule(`${stem}られる`, stem === "来" ? "来る" : "くる", ["v1"], "vk", "potential"),
    rule(`${stem}させる`, stem === "来" ? "来る" : "くる", ["v1"], "vk", "causative"),
    rule(`${stem}よう`, stem === "来" ? "来る" : "くる", [], "vk", "volitional"),
    rule(`${stem}い`, stem === "来" ? "来る" : "くる", [], "vk", "imperative")
  ]),
  rule("来れば", "来る", [], "vk", "conditional"),
  rule("くれば", "くる", [], "vk", "conditional")
]

const suru: Array<Rule> = [
  ...verbRules("vs", "する", { a: "し", i: "し", e: "す", o: "し", te: "して", ta: "した" }),
  rule("される", "する", ["v1"], "vs", "passive"),
  rule("させる", "する", ["v1"], "vs", "causative"),
  rule("しよう", "する", [], "vs", "volitional"),
  rule("しろ", "する", [], "vs", "imperative"),
  rule("せよ", "する", [], "vs", "imperative"),
  rule("すれば", "する", [], "vs", "conditional"),
  rule("せず", "する", [], "vs", "negative"),
  // 勉強する -> 勉強: nouns that take する are listed without it.
  rule("する", "", ["vs"], "vs-noun", "suru")
]

const adjectives: Array<Rule> = [
  rule("かった", "い", [], "adj-i", "past"),
  rule("くない", "い", ["adj-i"], "adj-i", "negative"),
  rule("くて", "い", [], "adj-i", "te"),
  rule("ければ", "い", [], "adj-i", "conditional"),
  rule("かったら", "い", [], "adj-i", "conditional"),
  rule("く", "い", [], "adj-i", "adverb"),
  rule("さ", "い", [], "adj-i", "noun"),
  rule("そう", "い", [], "adj-i", "seems"),
  rule("すぎる", "い", ["v1"], "adj-i", "too-much"),
  // いい conjugates from its older form よい.
  rule("よかった", "いい", [], "adj-i", "past"),
  rule("よくない", "いい", ["adj-i"], "adj-i", "negative"),
  rule("よくて", "いい", [], "adj-i", "te"),
  rule("よければ", "いい", [], "adj-i", "conditional")
]

const progressive: Array<Rule> = [
  rule("いる", "", ["v1"], "iru", "progressive"),
  rule("る", "", ["v1"], "iru", "progressive")
]

const RULES: ReadonlyArray<Rule> = [...ichidan, ...godan, ...iku, ...kuru, ...suru, ...adjectives, ...progressive]

/** Every way `word` could be deinflected, including `word` itself. */
export const deinflect = (word: string): Array<Deinflection> => {
  const results: Array<Deinflection> = [{ term: word, type: null, reasons: [] }]
  const seen = new Set([`${word}|`])

  for (let index = 0; index < results.length && results.length < 200; index++) {
    const current = results[index]!
    for (const candidate of RULES) {
      if (current.type !== null && !candidate.inTypes.includes(current.type)) continue
      if (!current.term.endsWith(candidate.from)) continue
      const term = current.term.slice(0, current.term.length - candidate.from.length) + candidate.to
      if (term.length === 0) continue
      // 〜て(い)る only follows a て-form.
      if (candidate.outType === "iru" && !/[てで]$/.test(term)) continue
      const key = `${term}|${candidate.outType}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ term, type: candidate.outType, reasons: [...current.reasons, candidate.reason] })
    }
  }

  return results.filter((result) => result.type !== "iru")
}

/** Whether an entry with the given JMDict part-of-speech tags can be the result of a deinflection. */
export const matchesPartOfSpeech = (type: WordType | null, partsOfSpeech: ReadonlyArray<string>) => {
  switch (type) {
    case null:
      return true
    case "v1":
      return partsOfSpeech.some((pos) => pos === "v1" || pos === "v1-s")
    case "v5":
      return partsOfSpeech.some((pos) => pos.startsWith("v5"))
    case "vk":
      return partsOfSpeech.includes("vk")
    case "vs":
      return partsOfSpeech.some((pos) => pos.startsWith("vs"))
    case "vs-noun":
      return partsOfSpeech.some((pos) => pos === "vs" || pos === "vs-s" || pos === "vs-i")
    case "adj-i":
      return partsOfSpeech.some((pos) => pos === "adj-i" || pos === "adj-ix")
    case "iru":
      return false
  }
}
