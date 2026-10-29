import type { EntryRecord } from "@kotori/db"
import { describe, expect, it } from "vitest"
import { mergeSources, toEntries } from "../src/build.ts"
import { parseEjdict } from "../src/ejdict.ts"
import { parseFrequency } from "../src/frequency.ts"
import { uninflect } from "../src/inflect.ts"
import { wordsFromJmdict } from "../src/jmdict.ts"
import { splitDefinition } from "../src/text.ts"
import { cleanIpa, parseWiktionary } from "../src/wiktionary.ts"

// Lines as Wiktextract writes them for Japanese Wiktionary, trimmed to the fields read.
const line = (entry: object) => JSON.stringify({ lang_code: "en", lang: "英語", ...entry })
const wiktionary = [
  line({
    word: "eat",
    pos: "verb",
    senses: [
      { glosses: ["～を食べる。"] },
      { glosses: ["やつれさせる。心配させる。"], tags: ["informal"] },
      { glosses: ["（資源や金銭を）消費する。浪費する。食う。"] }
    ],
    forms: [
      { form: "eats", tags: ["third-person", "singular", "present"] },
      { form: "eating", tags: ["present", "participle"] },
      { form: "ate", tags: ["past"] },
      { form: "eaten", tags: ["past", "participle"] }
    ],
    sounds: [{ ipa: "/en/" }, { ipa: "/iːt/" }, { ipa: "/i:t/", tags: ["X-SAMPA"] }],
    synonyms: [{ word: "consume" }, { word: "dine" }],
    derived: [{ word: "eat out" }, { word: "eatery" }]
  }),
  line({
    word: "eat",
    pos: "noun",
    senses: [{ glosses: ["(米話)食べ物。"] }],
    forms: [{ form: "eats", tags: ["plural"] }]
  }),
  line({
    word: "walk",
    pos: "verb",
    senses: [
      { glosses: ["歩く。"], tags: ["intransitive"] },
      { glosses: ["散歩させる。"], tags: ["transitive"], raw_tags: ["犬などを"] }
    ],
    forms: [{ form: "walked", tags: ["past", "participle"] }],
    derived: "[2]{word:string}\nwalk out\nwalk over\n"
  }),
  line({
    word: "make sense",
    pos: "phrase",
    senses: [
      {
        glosses: [
          "（現象が主語。主語が人の場合はその人の発言内容や態度などを意味する）納得できる。辻褄が合う。（＊原義は「意味を成す」）"
        ]
      }
    ]
  }),
  line({
    word: "tired",
    pos: "verb",
    senses: [{ glosses: ["tireの過去形・過去分詞"], tags: ["form-of"], form_of: [{ word: "tire" }] }]
  }),
  line({ word: "tired", pos: "adj", senses: [{ glosses: ["疲れた。"] }], forms: [{ form: "more tired" }] }),
  line({ word: "tire", pos: "verb", senses: [{ glosses: ["疲れる。"] }] }),
  // Pages for inflections, saying so only in the definition.
  line({ word: "ate", pos: "verb", senses: [{ glosses: ["eatの過去形"] }] }),
  line({
    word: "eaten",
    pos: "verb",
    senses: [{ glosses: ["eatの過去分詞"] }, { glosses: ["（特に複合語で）食べられる"] }]
  }),
  line({
    word: "hello",
    pos: "intj",
    senses: [{ glosses: ["こんにちは。"] }],
    forms: [
      { form: "hallo", tags: ["alternative"] },
      { form: "hullo", tags: ["alternative", "obsolete"] },
      { form: "または" }
    ]
  }),
  // Other languages share the file and are skipped.
  JSON.stringify({ word: "be", lang_code: "nb", pos: "verb", senses: [{ glosses: ["求める。"] }] })
]

const ejdict = [
  "team\t(スポーツの)『チーム』 / (共に仕事などをする)『一団』,一組 / …をチームにする《+『up』》",
  "guy\t控え綱 / 《米話》男,やつ",
  "was\tbeの一人称および三人称単数過去形",
  "be\t《連結語として補語を伴なって》…『である』,…だ / 〈物事が〉『存在する』,ある",
  "okay\t=OK,O.K.",
  "eat\t…を『食べる』",
  "light\t〈U〉『光』;明るさ / 〈C〉『明かり』"
]

describe("splitDefinition", () => {
  it("splits sentences and short synonym lists, not clauses", () => {
    expect(splitDefinition("青の、青色をした。藍色の、紺色の。").glosses).toEqual([
      "青の",
      "青色をした",
      "藍色の",
      "紺色の"
    ])
    expect(splitDefinition("人間の肌の色、特に人種や民族を指す。").glosses).toEqual([
      "人間の肌の色、特に人種や民族を指す"
    ])
  })

  it("keeps separators inside asides and sets whole asides apart as notes", () => {
    expect(splitDefinition("（現象が主語。主語が人）納得できる。（＊原義は「意味を成す」）")).toEqual({
      glosses: ["（現象が主語。主語が人）納得できる"],
      notes: ["＊原義は「意味を成す」"]
    })
  })
})

describe("parseWiktionary", () => {
  const { words, formsOf, phrases } = parseWiktionary(wiktionary)
  const word = (headword: string) => words.find((candidate) => candidate.headword === headword)

  it("merges a word's parts of speech into one headword, in page order", () => {
    const eat = word("eat")
    expect(eat?.ipa).toBe("/iːt/")
    expect(eat?.senses.map((sense) => [sense.glosses.map((gloss) => gloss.text), sense.pos, sense.misc])).toEqual([
      [["～を食べる"], ["v"], []],
      [["やつれさせる", "心配させる"], ["v"], ["col"]],
      [["（資源や金銭を）消費する", "浪費する", "食う"], ["v"], []],
      [["食べ物"], ["n"], ["col"]]
    ])
    expect(eat?.senses[3]?.dialects).toEqual(["en-US"])
    // Synonyms are listed for the whole part of speech, to be placed once every word is known.
    expect(eat?.senses[0]?.xrefs).toEqual([])
    expect(eat?.references).toEqual([{ from: 0, to: 3, synonyms: ["consume", "dine"], antonyms: [] }])
  })

  it("keeps real IPA and drops template debris", () => {
    expect(cleanIpa("/en/")).toBeNull()
    expect(cleanIpa("[list]")).toBeNull()
    expect(cleanIpa("//ɪnkənˈviːniənt//")).toBe("/ɪnkənˈviːniənt/")
    expect(cleanIpa("/'bɑðɚ/")).toBe("/ˈbɑðɚ/")
    expect(cleanIpa("[tʰeɪk]")).toBe("[tʰeɪk]")
  })

  it("reads inflections, with a regular verb's one past form as both past and participle", () => {
    expect(word("eat")?.inflections).toEqual([
      { text: "eats", tags: ["third-person", "plural"] },
      { text: "eating", tags: ["present-participle"] },
      { text: "ate", tags: ["past"] },
      { text: "eaten", tags: ["past-participle"] }
    ])
    expect(word("walk")?.inflections).toEqual([{ text: "walked", tags: ["past", "past-participle"] }])
  })

  it("files transitivity as part of speech and keeps context labels in the gloss", () => {
    expect(word("walk")?.senses.map((sense) => [sense.glosses[0]?.text, sense.pos])).toEqual([
      ["歩く", ["v", "vi"]],
      ["（犬などを）散歩させる", ["v", "vt"]]
    ])
  })

  it("turns form-of senses into forms of their word, and keeps the word's own senses", () => {
    expect(formsOf).toEqual([
      { text: "tired", base: "tire", tags: ["past", "past-participle"] },
      { text: "ate", base: "eat", tags: ["past"] },
      { text: "eaten", base: "eat", tags: ["past-participle"] }
    ])
    expect(word("tired")?.senses.map((sense) => sense.glosses[0]?.text)).toEqual(["疲れた"])
    // "ate" is only eat's past, so it is no word of its own; "eaten" also has a meaning.
    expect(word("ate")).toBeUndefined()
    expect(word("eaten")?.senses.map((sense) => sense.glosses[0]?.text)).toEqual(["（特に複合語で）食べられる"])
  })

  it("keeps everyday spellings and drops obsolete ones and non-English text", () => {
    expect(word("hello")?.spellings).toEqual(["hallo"])
  })

  it("collects the phrases listed under words, and notes from asides", () => {
    expect([...phrases]).toEqual(["eat out", "walk out", "walk over"])
    expect(word("make sense")?.senses[0]).toMatchObject({
      glosses: [
        { text: "（現象が主語。主語が人の場合はその人の発言内容や態度などを意味する）納得できる" },
        { text: "辻褄が合う" }
      ],
      info: ["＊原義は「意味を成す」"],
      pos: ["exp"]
    })
    expect(word("be")).toBeUndefined()
  })
})

describe("parseEjdict", () => {
  const { words, formsOf } = parseEjdict(ejdict)
  const word = (headword: string) => words.find((candidate) => candidate.headword === headword)

  it("reads meanings as senses, their usage labels as tags and grammar notes as notes", () => {
    expect(
      word("team")?.senses.map((sense) => [sense.glosses.map((gloss) => gloss.text), sense.pos, sense.info])
    ).toEqual([
      [["(スポーツの)チーム"], [], []],
      [["(共に仕事などをする)一団", "一組"], [], []],
      [["…をチームにする"], ["v", "vt"], ["+up"]]
    ])
    expect(word("guy")?.senses[1]).toMatchObject({ dialects: ["en-US"], misc: ["col"] })
    expect(word("light")?.senses[0]).toMatchObject({ pos: ["n"], misc: ["uncountable"] })
  })

  it("turns lines that only name another word's form into forms of it", () => {
    expect(formsOf).toEqual([
      { text: "was", base: "be", tags: ["past"] },
      { text: "okay", base: "OK", tags: [] },
      { text: "okay", base: "O.K.", tags: [] }
    ])
    expect(word("was")).toBeUndefined()
  })
})

describe("uninflect", () => {
  it.each([
    ["parties", "party"],
    ["boxes", "box"],
    ["teams", "team"],
    ["stopped", "stop"],
    ["baked", "bake"],
    ["running", "run"],
    ["making", "make"],
    ["lying", "lie"],
    ["bigger", "big"],
    ["happiest", "happy"]
  ])("%s -> %s", (word, base) => {
    expect(uninflect(word).map((candidate) => candidate.base)).toContain(base)
  })

  it("leaves -ss words whole", () => {
    expect(uninflect("glass").map((candidate) => candidate.base)).not.toContain("glas")
  })
})

const jmdictEntry = (
  id: number,
  headword: string,
  reading: string,
  glosses: Array<string>,
  common = true
): EntryRecord => ({
  id,
  language: "ja",
  headword,
  reading,
  common,
  priority: common ? 60 : 0,
  forms: [],
  senses: [
    {
      glosses: glosses.map((text) => ({ text, type: null })),
      pos: ["v5b"],
      misc: [],
      fields: [],
      dialects: [],
      info: [],
      stagk: [],
      stagr: [],
      xrefs: [],
      antonyms: []
    }
  ]
})

describe("wordsFromJmdict", () => {
  const known = {
    words: new Set(["hang", "eat", "team"]),
    verbs: new Set(["hang", "eat"]),
    phrases: new Set(["eat out"]),
    frequency: new Map([
      ["selfie", 900],
      ["teams", 500],
      ["kata", 300]
    ])
  }
  const words = wordsFromJmdict(
    [
      jmdictEntry(1, "遊ぶ", "あそぶ", ["to play", "to hang out"]),
      jmdictEntry(2, "たむろする", "たむろする", ["to hang out"], false),
      jmdictEntry(3, "自撮り", "じどり", ["selfie"], false),
      jmdictEntry(4, "外食", "がいしょく", ["eating out", "to eat out"]),
      jmdictEntry(5, "秋晴れ", "あきばれ", ["clear autumnal weather"]),
      jmdictEntry(6, "型", "かた", ["kata"]),
      jmdictEntry(7, "ディズニー", "ディズニー", ["Disney"]),
      jmdictEntry(8, "組", "くみ", ["teams"])
    ],
    known
  )

  it("reads attested words and phrases backwards, the likeliest Japanese word first", () => {
    expect(words.map((word) => [word.headword, word.senses.map((sense) => sense.glosses[0]?.text)])).toEqual([
      ["hang out", ["遊ぶ", "たむろする"]],
      ["selfie", ["自撮り"]],
      ["eat out", ["外食"]]
    ])
    expect(words[0]?.senses[0]?.pos).toEqual(["v"])
  })
})

describe("toEntries", () => {
  const frequency = parseFrequency(["eat 5000", "ate 3000", "team 4000", "be 90000", "was 80000", "hello 100"])
  const merged = mergeSources({
    wiktionary: parseWiktionary(wiktionary),
    ejdict: parseEjdict(ejdict),
    jmdict: [],
    frequency
  })

  it("takes each word from the first source that has it, with the forms the others point at", () => {
    const sources = new Map(merged.map((word) => [word.headword, word.source]))
    expect(sources.get("eat")).toBe("wiktionary")
    expect(sources.get("team")).toBe("ejdict")
    expect(merged.find((word) => word.headword === "be")?.inflections.get("was")).toEqual(new Set(["past"]))
    expect(merged.find((word) => word.headword === "tire")?.inflections.has("tired")).toBe(true)
  })

  it("places synonyms on the sense they share a meaning with, and leaves out the rest", () => {
    const placed = mergeSources({
      wiktionary: parseWiktionary([
        line({
          word: "eat",
          pos: "verb",
          senses: [{ glosses: ["～を食べる。"] }, { glosses: ["食事をする。"] }, { glosses: ["心配させる。"] }],
          synonyms: [{ word: "dine" }, { word: "bother" }, { word: "chow down" }],
          antonyms: [{ word: "fast" }]
        }),
        line({ word: "dine", pos: "verb", senses: [{ glosses: ["食事をとる。"] }] }),
        line({
          word: "bother",
          pos: "verb",
          senses: [{ glosses: ["悩ます、困らせる。"] }, { glosses: ["心配させる。"] }]
        }),
        line({ word: "awkward", pos: "adj", senses: [{ glosses: ["不器用な。"] }], antonyms: [{ word: "handy" }] })
      ]),
      ejdict: { words: [], formsOf: [] },
      jmdict: [],
      frequency
    })
    const entries = toEntries(placed, frequency, new Map())
    const eat = entries.find((entry) => entry.headword === "eat")
    expect(eat?.senses.map((sense) => sense.xrefs)).toEqual([[], ["dine"], ["bother"]])
    // An antonym can only be placed when there is one sense to place it on.
    expect(eat?.senses.every((sense) => sense.antonyms.length === 0)).toBe(true)
    expect(entries.find((entry) => entry.headword === "awkward")?.senses[0]?.antonyms).toEqual(["handy"])
  })

  it("ranks words by how often they and their inflections are used, and keeps ids stable", () => {
    const entries = toEntries(merged, frequency, new Map([["team", 100000007]]))
    expect(entries.slice(0, 3).map((entry) => [entry.headword, entry.id, entry.priority])).toEqual([
      ["be", 100000008, Math.round(20 * Math.log10(170000))],
      ["eat", 100000009, Math.round(20 * Math.log10(8000))],
      ["team", 100000007, Math.round(20 * Math.log10(4000))]
    ])
    const eat = entries.find((entry) => entry.headword === "eat")
    expect(eat).toMatchObject({ language: "en", reading: "/iːt/", common: true })
    expect(eat?.forms.map((form) => [form.kind, form.text])).toEqual([
      ["spelling", "eat"],
      ["inflection", "eats"],
      ["inflection", "eating"],
      ["inflection", "ate"],
      ["inflection", "eaten"]
    ])
    expect(entries.find((entry) => entry.headword === "make sense")).toMatchObject({ common: false, priority: 0 })
  })
})
