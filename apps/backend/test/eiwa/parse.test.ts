import { EntryId, type EntryRecord } from "@kotori/contracts"
import { describe, expect, it } from "vitest"
import { commonestFirst, mergeSources, toEntries } from "../../src/features/dictionary/import/eiwa/build.ts"
import { parseFrequency } from "../../src/features/dictionary/import/eiwa/frequency.ts"
import { jmdictReader, wordsFromJmdict } from "../../src/features/dictionary/import/eiwa/jmdict.ts"
import { splitDefinition } from "../../src/features/dictionary/import/eiwa/text.ts"
import {
  cleanIpa,
  parseCurated,
  parsePhraseIndex,
  parseWiktionary
} from "../../src/features/dictionary/import/eiwa/wiktionary.ts"
import { emptySense, formOf } from "../../src/features/dictionary/import/eiwa/words.ts"

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
  // Pages for inflections and other spellings, saying so only in the definition, as Wiktionary
  // writes it: bare, quoted, or after a label.
  line({ word: "ate", pos: "verb", senses: [{ glosses: ["eatの過去形"] }] }),
  line({
    word: "eaten",
    pos: "verb",
    senses: [{ glosses: ["eatの過去分詞"] }, { glosses: ["（特に複合語で）食べられる"] }]
  }),
  line({ word: "asked", pos: "verb", senses: [{ glosses: ['"ask" の過去形・過去分詞形。'] }] }),
  line({ word: "gotten", pos: "verb", senses: [{ glosses: ["(米) getの過去分詞"] }] }),
  line({ word: "judgement", pos: "noun", senses: [{ glosses: ["judgmentの異綴、米国でも時折みられる"] }] }),
  // Senses Wiktionary lists oldest first.
  line({
    word: "sad",
    pos: "adj",
    senses: [{ glosses: ["満足した。"], tags: ["obsolete"] }, { glosses: ["悲しい。"] }]
  }),
  // Lines that aren't JSON, or aren't shaped like an entry, are skipped.
  '{"word": "broken", "lang_code": "en", ',
  line({ word: "mistyped", pos: "verb", senses: "走る。" }),
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
      { text: "eaten", base: "eat", tags: ["past-participle"] },
      { text: "asked", base: "ask", tags: ["past", "past-participle"] },
      { text: "gotten", base: "get", tags: ["past-participle"] },
      { text: "judgement", base: "judgment", tags: [] }
    ])
    expect(word("tired")?.senses.map((sense) => sense.glosses[0]?.text)).toEqual(["疲れた"])
    // "ate" is only eat's past, so it is no word of its own; "eaten" also has a meaning.
    expect(word("ate")).toBeUndefined()
    expect(word("asked")).toBeUndefined()
    expect(word("eaten")?.senses.map((sense) => sense.glosses[0]?.text)).toEqual(["（特に複合語で）食べられる"])
  })

  it("keeps standalone abbreviation, acronym, clipping and ellipsis senses even when form_of is present", () => {
    const { words: parsed } = parseWiktionary([
      line({
        word: "goat",
        pos: "noun",
        senses: [
          { glosses: ["ヤギ。"] },
          {
            glosses: ["Greatest Of All Time（史上最高）の頭字語。"],
            tags: ["abbreviation", "alt-of", "form-of", "initialism", "slang"],
            form_of: [{ word: "Greatest Of All Time" }]
          }
        ]
      })
    ])
    expect(parsed[0]?.senses.map((s) => s.glosses[0]?.text)).toEqual([
      "ヤギ",
      "Greatest Of All Time（史上最高）の頭字語"
    ])
  })

  it("skips lines that aren't entries", () => {
    expect(word("broken")).toBeUndefined()
    expect(word("mistyped")).toBeUndefined()
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

  it("extracts phrases from related fields while skipping proper nouns and loading redirects", () => {
    const parsed = parseWiktionary([
      line({
        word: "matter",
        pos: "noun",
        senses: [
          {
            glosses: ["問題。"],
            links: [
              ["to make matters worse", "to make matters worse"],
              ["no matter what", "no matter what"],
              ["Abu Dhabi", "Abu Dhabi"]
            ],
            alt_of: [{ word: "a matter of time" }]
          }
        ],
        proverbs: [{ word: "the die is cast" }],
        related: [{ word: "as a matter of fact" }],
        collocations: [{ word: "for that matter" }],
        synonyms: [{ word: "state of affairs" }]
      }),
      line({
        word: "Bosnia and Herzegovina",
        pos: "name",
        senses: [{ glosses: ["ボスニア・ヘルツェゴビナ。"], links: [["Balkan Peninsula", "Balkan Peninsula"]] }]
      })
    ])
    expect([...parsed.phrases]).toEqual([
      "the die is cast",
      "as a matter of fact",
      "for that matter",
      "state of affairs",
      "a matter of time",
      "to make matters worse",
      "no matter what"
    ])

    const index = parsePhraseIndex(
      JSON.stringify({
        phrases: ["to make matters worse", "on thin ice", "let the cat out of the bag"],
        redirects: {
          "to skate on thin ice": "on thin ice",
          "walk on thin ice": "on thin ice"
        }
      })
    )
    expect([...index.phrases]).toEqual(["to make matters worse", "on thin ice", "let the cat out of the bag"])
    expect([...index.redirects]).toEqual([
      ["skate on thin ice", "on thin ice"],
      ["walk on thin ice", "on thin ice"]
    ])
  })
})

const jmdictEntry = (
  id: number,
  headword: string,
  reading: string,
  glosses: Array<string>,
  common = true,
  pos: Array<string> = ["v5b"],
  misc: Array<string> = []
): EntryRecord => ({
  id: EntryId.make(id),
  language: "ja",
  headword,
  reading,
  common,
  priority: common ? 60 : 0,
  forms: [],
  senses: [
    {
      glosses: glosses.map((text) => ({ text, type: null })),
      pos,
      misc,
      fields: [],
      dialects: [],
      info: [],
      stagk: [],
      stagr: [],
      xrefs: [],
      antonyms: [],
      sources: [],
      wasei: false
    }
  ]
})

describe("formOf", () => {
  it.each([
    ["eatの過去形", "eat", ["past"]],
    ['"ask" の過去形・過去分詞形。', "ask", ["past", "past-participle"]],
    ["「look」の複数形", "look", ["plural"]],
    ["strange の比較級。", "strange", ["comparative"]],
    ["cinqueの旧綴り。", "cinque", []],
    ["'tisの異綴。", "'tis", []]
  ])("%s is a form of %s", (gloss, base, tags) => {
    expect(formOf(gloss)).toEqual({ base, tags })
  })

  it.each(["走る", "(俗) for の略記。", "doの二人称・単数・現在形"])("%s is a meaning", (gloss) => {
    expect(formOf(gloss)).toBeNull()
  })
})

describe("wordsFromJmdict", () => {
  const known = {
    words: new Set(["hang", "eat", "team"]),
    verbs: new Set(["hang", "eat"]),
    phrases: new Set(["eat out"]),
    frequency: new Map([
      ["selfie", 900],
      ["teams", 500],
      ["kata", 300],
      ["website", 800],
      ["kim", 5000],
      ["ex-wife", 600]
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
      jmdictEntry(8, "組", "くみ", ["teams"]),
      jmdictEntry(9, "ウェブサイト", "ウェブサイト", ["website"]),
      jmdictEntry(10, "韓国海苔", "かんこくのり", ["gim", "kim"], false),
      jmdictEntry(11, "元妻", "もとつま", ["ex-wife"], false)
    ],
    known
  )
  const word = (headword: string) => words.find((candidate) => candidate.headword === headword)

  it("reads attested words and phrases backwards, grouping same-POS Japanese candidates into one sense", () => {
    expect(words.map((word) => [word.headword, word.senses.map((sense) => sense.glosses.map((g) => g.text))])).toEqual([
      ["hang out", [["遊ぶ", "たむろする"]]],
      ["selfie", [["自撮り"]]],
      ["eat out", [["外食"]]],
      ["website", [["ウェブサイト"]]],
      ["kim", [["韓国海苔"]]],
      ["ex-wife", [["元妻"]]]
    ])
    expect(words[0]?.senses[0]?.pos).toEqual(["v"])
  })

  it("trusts a word's count when a common Japanese word glosses it, it is hyphenated, or it is a multi-word phrase", () => {
    expect(word("website")?.mayBeName).toBe(false)
    expect(word("ex-wife")?.mayBeName).toBe(false)
    expect(word("eat out")?.mayBeName).toBe(false)
    // The subtitles count Kim, the name.
    expect(word("kim")?.mayBeName).toBe(true)
    expect(word("selfie")?.mayBeName).toBe(true)
  })

  it("collapses verb-variant and redirected idioms onto their canonical headword", () => {
    const reader = jmdictReader({
      words: new Set(["on the fence", "a lot of"]),
      verbs: new Set(),
      phrases: new Set([
        "on thin ice",
        "on the fence",
        "let the cat out of the bag",
        "hit the nail on the head",
        "to make matters worse",
        "the die is cast"
      ]),
      redirects: new Map([["skate on thin ice", "on thin ice"]]),
      frequency: new Map()
    })
    for (const item of [
      jmdictEntry(
        20,
        "薄氷を踏む",
        "はくひょうをふむ",
        ["to tread on thin ice", "to walk on thin ice", "to skate on thin ice"],
        false,
        ["exp", "v5m"],
        ["id"]
      ),
      jmdictEntry(
        21,
        "危ない橋を渡る",
        "あぶないはしをわたる",
        ["to tread on thin ice", "to find oneself on thin ice"],
        false,
        ["exp", "v5r"],
        ["id"]
      ),
      jmdictEntry(22, "綱渡り", "つなわたり", ["walking on a tightrope", "tread on thin ice"], true, ["n", "vs"]),
      jmdictEntry(
        23,
        "語るに落ちる",
        "かたるにおちる",
        ["to let the cat out of the bag"],
        false,
        ["exp", "v1"],
        ["id"]
      ),
      jmdictEntry(24, "図星を指す", "ずぼしをさす", ["to hit the nail on the head"], false, ["exp", "v5s"], ["id"]),
      jmdictEntry(25, "泣きっ面に蜂", "なきっつらにはち", ["to make matters worse"], false, ["exp"], ["proverb"]),
      jmdictEntry(26, "賽は投げられた", "さいはなげられた", ["the die is cast"], false, ["exp"], ["proverb"]),
      jmdictEntry(27, "日和見", "ひよりみ", ["sitting on the fence", "to sit on the fence"], false, ["n", "vs"]),
      jmdictEntry(28, "たくさん", "たくさん", ["a lot of"], true, ["adj-na", "adv"])
    ]) {
      reader.add(item)
    }

    const built = reader.finish()
    const onThinIce = built.find((w) => w.headword === "on thin ice")
    expect(onThinIce?.spellings).toEqual([
      "tread on thin ice",
      "walk on thin ice",
      "skate on thin ice",
      "find oneself on thin ice"
    ])
    expect(onThinIce?.mayBeName).toBe(false)
    expect(onThinIce?.senses.map((s) => [s.pos, s.glosses.map((g) => g.text)])).toEqual([
      [["n"], ["綱渡り"]],
      [["exp"], ["薄氷を踏む", "危ない橋を渡る"]]
    ])
    expect(built.find((w) => w.headword === "let the cat out of the bag")?.senses[0]?.glosses[0]?.text).toBe(
      "語るに落ちる"
    )
    expect(built.find((w) => w.headword === "hit the nail on the head")?.senses[0]?.glosses[0]?.text).toBe("図星を指す")
    expect(built.find((w) => w.headword === "to make matters worse")?.senses[0]?.glosses[0]?.text).toBe("泣きっ面に蜂")
    expect(built.find((w) => w.headword === "the die is cast")?.senses[0]?.glosses[0]?.text).toBe("賽は投げられた")
    expect(built.find((w) => w.headword === "lot of")).toBeUndefined()
    expect(reader.formsOf()).toContainEqual({ text: "sit on the fence", base: "on the fence", tags: [] })
  })
})

describe("toEntries", () => {
  const frequency = parseFrequency([
    "eat 5000",
    "ate 3000",
    "team 4000",
    "be 90000",
    "was 80000",
    "hither 800",
    "hello 100"
  ])
  const merged = mergeSources({
    curated: parseCurated([
      JSON.stringify({
        headword: "be",
        ipa: "/biː/",
        familiarity: 5,
        senses: [{ pos: ["v"], glosses: ["～である", "いる、ある"] }]
      })
    ]),
    wiktionary: parseWiktionary([
      ...wiktionary,
      line({ word: "was", pos: "verb", senses: [{ glosses: ["beの過去形"] }] })
    ]),
    jmdict: {
      words: [
        {
          headword: "team",
          ipa: null,
          spellings: [],
          inflections: [],
          senses: [{ ...emptySense(), glosses: [{ text: "チーム", type: null }], pos: ["n"] }],
          mayBeName: false
        }
      ]
    },
    frequency
  })

  it("takes each word from the first source that has it, with the forms the others point at", () => {
    const sources = new Map(merged.map((word) => [word.headword, word.source]))
    expect(sources.get("be")).toBe("curated")
    expect(sources.get("eat")).toBe("wiktionary")
    expect(sources.get("team")).toBe("jmdict")
    expect(merged.find((word) => word.headword === "be")?.inflections.get("was")).toEqual(new Set(["past"]))
    expect(merged.find((word) => word.headword === "tire")?.inflections.has("tired")).toBe(true)
  })

  it("prefers curated entries over wiktionary, inherits lower-tier variant spellings, and scales priority by familiarity and back-translations", () => {
    const curated = parseCurated([
      JSON.stringify({
        headword: "kid",
        ipa: "/kɪd/",
        familiarity: 5,
        inflections: [{ text: "kids", tags: ["plural", "third-person"] }],
        senses: [
          { pos: ["n"], misc: ["col"], glosses: ["子供", "若者"] },
          { pos: ["v"], misc: ["col"], glosses: ["冗談を言う", "からかう"] },
          { pos: ["n"], glosses: ["子ヤギ"] }
        ]
      }),
      JSON.stringify({
        headword: "on thin ice",
        ipa: "/ɒn ˈθɪn ˈaɪs/",
        familiarity: 5,
        spellings: ["skate on thin ice"],
        senses: [{ pos: ["exp"], misc: ["id"], glosses: ["薄氷を踏む", "危ない橋を渡る", "危険な状態にある"] }]
      }),
      JSON.stringify({
        headword: "keep it real",
        ipa: "/ˈkiːp ɪt ˈɹiːl/",
        familiarity: 4,
        senses: [{ pos: ["v"], misc: ["col"], glosses: ["ありのままでいる", "本音で話す"] }]
      }),
      JSON.stringify({
        headword: "no cap",
        ipa: "/noʊ kæp/",
        familiarity: 3,
        senses: [{ pos: ["int"], misc: ["sl"], glosses: ["マジで", "ガチで"] }]
      }),
      JSON.stringify({
        headword: "hither",
        ipa: "/ˈhɪðəɹ/",
        familiarity: 1,
        senses: [{ pos: ["adv"], misc: ["arch"], glosses: ["こちらへ"] }]
      })
    ])
    const withCurated = mergeSources({
      curated,
      wiktionary: parseWiktionary([
        line({ word: "kid", pos: "noun", senses: [{ glosses: ["子山羊。"] }, { glosses: ["子供。"] }] }),
        line({ word: "on the fence", pos: "phrase", senses: [{ glosses: ["日和見で。"] }] })
      ]),
      jmdict: {
        words: [
          {
            headword: "cut corners",
            ipa: null,
            spellings: [],
            inflections: [],
            senses: [{ ...emptySense(), glosses: [{ text: "手を抜く", type: null }], pos: ["exp"] }],
            mayBeName: false
          }
        ],
        formsOf: [
          { text: "tread on thin ice", base: "on thin ice", tags: [] },
          { text: "walk on thin ice", base: "on thin ice", tags: [] },
          { text: "sit on the fence", base: "on the fence", tags: [] }
        ]
      },
      frequency
    })
    const entries = toEntries(
      withCurated,
      frequency,
      new Map(),
      new Map([
        ["kid", new Map([["子ヤギ", 99]])],
        ["cut corners", new Map([["手を抜く", 50]])],
        ["on the fence", new Map([["日和見", 35]])]
      ])
    )
    const kid = entries.find((e) => e.headword === "kid")
    expect(kid?.source).toBe("curated")
    // Curated sense order stands even if backTranslations weights another sense higher.
    expect(kid?.senses.map((s) => s.glosses[0]?.text)).toEqual(["子供", "冗談を言う", "子ヤギ"])

    const onThinIce = entries.find((e) => e.headword === "on thin ice")
    expect(onThinIce?.priority).toBe(80)
    expect(onThinIce?.common).toBe(true)
    expect(onThinIce?.forms.map((f) => f.text)).toEqual([
      "on thin ice",
      "skate on thin ice",
      "tread on thin ice",
      "walk on thin ice"
    ])

    expect(entries.find((e) => e.headword === "keep it real")).toMatchObject({ priority: 70, common: true })
    expect(entries.find((e) => e.headword === "no cap")).toMatchObject({ priority: 60, common: false })
    expect(entries.find((e) => e.headword === "hither")).toMatchObject({
      priority: Math.round(20 * Math.log10(800)),
      common: true
    })

    const cutCorners = entries.find((e) => e.headword === "cut corners")
    expect(cutCorners).toMatchObject({ priority: 68, common: true })
    const onTheFence = entries.find((e) => e.headword === "on the fence")
    expect(onTheFence).toMatchObject({ priority: 60, common: false })
    expect(onTheFence?.forms.map((f) => f.text)).toEqual(["on the fence", "sit on the fence"])
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
      jmdict: { words: [] },
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

  it("lists rare, dated and obsolete senses last", () => {
    const sad = toEntries(merged, frequency, new Map()).find((entry) => entry.headword === "sad")
    expect(sad?.senses.map((sense) => [sense.glosses[0]?.text, sense.misc])).toEqual([
      ["悲しい", []],
      ["満足した", ["obs"]]
    ])
  })

  it("marks a word common only when its count can be trusted", () => {
    const counts = parseFrequency(["kim 5000", "website 800"])
    const jmdictOnly = (headword: string, mayBeName: boolean) => ({
      headword,
      ipa: null,
      spellings: [],
      inflections: [],
      senses: [{ ...emptySense(), glosses: [{ text: "ウェブサイト", type: null }] }],
      mayBeName
    })
    const entries = toEntries(
      mergeSources({
        wiktionary: { words: [], formsOf: [] },
        jmdict: { words: [jmdictOnly("kim", true), jmdictOnly("website", false)] },
        frequency: counts
      }),
      counts,
      new Map()
    )
    expect(entries.map((entry) => [entry.headword, entry.common])).toEqual([
      ["kim", false],
      ["website", true]
    ])
  })
})

describe("commonestFirst", () => {
  const sense = (glosses: Array<string>, misc: Array<string> = []) => ({
    ...emptySense(),
    glosses: glosses.map((text) => ({ text, type: null })),
    misc
  })
  const order = (senses: ReturnType<typeof sense>[], weights: Record<string, number>) =>
    commonestFirst(senses, new Map(Object.entries(weights))).map((own) => own.glosses[0]?.text)

  it("leads with the first attested sense, then the other attested ones by weight, the rest after", () => {
    // "kid" as Wiktionary lists it: no common Japanese word translates "kid" as a young goat.
    const kid = [
      sense(["仔やぎ"]),
      sense(["子供"]),
      sense(["からかう", "ふざける"]),
      sense(["冗談を言う"]),
      sense(["子分"], ["obs"])
    ]
    expect(order(kid, { 子供: 50, ふざける: 90, 冗談を言う: 70, 子分: 99 })).toEqual([
      "子供",
      "からかう",
      "冗談を言う",
      "仔やぎ",
      "子分"
    ])
    // Its heaviest word decides a sense's weight, not how many synonyms it lists.
    expect(
      order([sense(["涼しい"]), sense(["冷淡な", "冷ややかな", "冷たい"]), sense(["冷静な"])], {
        涼しい: 80,
        冷淡: 40,
        冷ややか: 40,
        冷たい: 40,
        冷静: 60
      })
    ).toEqual(["涼しい", "冷静な", "冷淡な"])
    // Without back-translations, Wiktionary's order stands but for the little-used senses.
    expect(order([sense(["満足した"], ["obs"]), sense(["悲しい"])], {})).toEqual(["悲しい", "満足した"])
  })

  it("matches na-adjectives, adverbs and suru verbs to JMDict's bare spellings", () => {
    expect(order([sense(["痛む"]), sense(["利口な"]), sense(["勉強する"])], { 利口: 10, 勉強: 20 })).toEqual([
      "利口な",
      "勉強する",
      "痛む"
    ])
  })
})

describe("jmdictReader backTranslations", () => {
  const entry = (
    id: number,
    word: string,
    glosses: Array<string>,
    common = true,
    sense = 0,
    pos: Array<string> = ["v5b"],
    misc: Array<string> = []
  ): EntryRecord => ({
    ...jmdictEntry(id, word, word, glosses, common, pos, misc),
    forms: [{ kind: "kanji", text: word, common, tags: [], priorities: [], restrictions: [], noKanji: false }],
    senses: [
      ...Array.from({ length: sense }, () => jmdictEntry(id, word, word, ["other"], common, pos, misc).senses[0]!),
      jmdictEntry(id, word, word, glosses, common, pos, misc).senses[0]!
    ]
  })

  it("collects the common Japanese words JMDict translates with a known English word, from their leading glosses", () => {
    const reader = jmdictReader({
      words: new Set(["smart", "kid"]),
      verbs: new Set(),
      phrases: new Set(),
      frequency: new Map()
    })
    reader.add(entry(1, "賢い", ["wise", "clever", "smart"]))
    reader.add(entry(2, "粋", ["chic", "stylish", "refined", "elegant", "smart"]))
    reader.add(entry(3, "洒脱", ["smart"], false))
    reader.add(entry(4, "利口", ["smart"], true, 3))
    reader.add(entry(5, "子供", ["child", "children"]))
    const smart = reader.backTranslations().get("smart")
    // A fifth gloss, an uncommon word or a fourth sense is too far from the word's use to count.
    expect([...(smart?.keys() ?? [])]).toEqual(["賢い"])
    expect(reader.backTranslations().has("kid")).toBe(false)
  })

  it("includes Japanese expressions and idioms in back-translations even when not marked common", () => {
    const reader = jmdictReader({
      words: new Set(["on thin ice"]),
      verbs: new Set(),
      phrases: new Set(["on thin ice", "cut corners"]),
      frequency: new Map()
    })
    reader.add(entry(6, "薄氷を踏む", ["to tread on thin ice"], false, 0, ["exp", "v5m"], ["id"]))
    reader.add(entry(7, "手を抜く", ["to cut corners"], false, 0, ["exp", "v5k"], ["id"]))
    expect([...(reader.backTranslations().get("on thin ice")?.keys() ?? [])]).toEqual(["薄氷を踏む"])
    expect([...(reader.backTranslations().get("cut corners")?.keys() ?? [])]).toEqual(["手を抜く"])
  })
})
