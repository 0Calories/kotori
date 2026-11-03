import { describe, expect, it } from "vitest"
import { commonestFirst, mergeSources, toEntries } from "../../src/features/dictionary/import/eiwa/build.ts"
import { mergeConsolidatedWord } from "../../src/features/dictionary/import/eiwa/consolidate.ts"
import { parseFrequency } from "../../src/features/dictionary/import/eiwa/frequency.ts"
import { cleanIpa, parseEnWiktionary, parseWiktionary } from "../../src/features/dictionary/import/eiwa/wiktionary.ts"
import { emptySense, toConsolidatedWord, type Word } from "../../src/features/dictionary/import/eiwa/words.ts"

const rawLine = (entry: object) => JSON.stringify({ lang_code: "en", lang: "English", ...entry })

const rawEnWiktionary = [
  rawLine({
    word: "eat",
    pos: "verb",
    senses: [
      { glosses: ["To ingest food."], tags: ["transitive", "intransitive"] },
      { glosses: ["To bother or worry."], tags: ["informal", "transitive"], synonyms: [{ word: "bother" }] },
      { glosses: ["To consume resources."] }
    ],
    forms: [
      { form: "eats", tags: ["third-person", "singular", "present"] },
      { form: "eating", tags: ["present", "participle"] },
      { form: "ate", tags: ["past"] },
      { form: "eaten", tags: ["past", "participle"] }
    ],
    sounds: [{ ipa: "/en/" }, { ipa: "/iːt/", tags: ["UK"] }, { ipa: "/it/", tags: ["US"] }, { ipa: "/i:t/", tags: ["X-SAMPA"] }],
    synonyms: [{ word: "consume" }, { word: "dine" }],
    derived: [{ word: "eat out" }, { word: "eatery" }],
    translations: [{ code: "ja", word: "食べる", sense: "ingest" }]
  }),
  rawLine({
    word: "eat",
    pos: "noun",
    senses: [{ glosses: ["Food."], tags: ["US", "colloquial"] }],
    forms: [{ form: "eats", tags: ["plural"] }]
  }),
  rawLine({
    word: "keep it real",
    pos: "verb",
    senses: [
      {
        glosses: ["To be authentic; to act according to one's true nature."],
        tags: ["colloquial"],
        synonyms: [{ word: "keep it one hundred" }]
      },
      { glosses: ["Used as a farewell."], tags: ["colloquial", "idiomatic"] }
    ],
    forms: [
      { form: "keeps it real", tags: ["present", "singular", "third-person"] },
      { form: "keeping it real", tags: ["participle", "present"] },
      { form: "kept it real", tags: ["participle", "past"] }
    ],
    sounds: [{ ipa: "/ˈkiːp ɪt ˈɹiːl/", tags: ["US"] }]
  }),
  rawLine({
    word: "slay",
    pos: "verb",
    senses: [
      { glosses: ["To kill; to murder."], tags: ["formal", "transitive"] },
      { glosses: ["To do extraordinarily well."], tags: ["slang"], synonyms: [{ word: "rule" }] }
    ],
    forms: [
      { form: "slays", tags: ["present", "singular", "third-person"] },
      { form: "slaying", tags: ["participle", "present"] },
      { form: "slew", tags: ["past"] },
      { form: "slayed", tags: ["past", "participle", "slang"] },
      { form: "slain", tags: ["participle", "past"] },
      { form: "yslain", tags: ["archaic", "obsolete", "participle", "past"] }
    ]
  }),
  rawLine({
    word: "GOAT",
    pos: "noun",
    senses: [
      {
        glosses: ["Acronym of greatest of all time."],
        tags: ["acronym", "alt-of", "slang"],
        alt_of: [{ word: "greatest of all time" }]
      }
    ],
    forms: [{ form: "GOATs", tags: ["plural"] }]
  }),
  rawLine({
    word: "tired",
    pos: "verb",
    senses: [{ glosses: ["simple past and past participle of tire"], tags: ["form-of", "past", "participle"], form_of: [{ word: "tire" }] }]
  }),
  rawLine({ word: "tired", pos: "adj", senses: [{ glosses: ["In need of rest."] }], forms: [{ form: "more tired" }] }),
  rawLine({ word: "tire", pos: "verb", senses: [{ glosses: ["To become sleepy."] }] }),
  rawLine({
    word: "ate",
    pos: "verb",
    senses: [{ glosses: ["simple past of eat"], tags: ["form-of", "past"], form_of: [{ word: "eat" }] }]
  }),
  rawLine({
    word: "judgement",
    pos: "noun",
    senses: [{ glosses: ["Alternative spelling of judgment."], tags: ["alt-of", "alternative"], alt_of: [{ word: "judgment" }] }]
  }),
  '{"word": "broken", "lang_code": "en", ',
  rawLine({ word: "mistyped", pos: "verb", senses: "run" }),
  rawLine({
    word: "sidewalk",
    pos: "noun",
    senses: [{ glosses: ["A paved footpath."] }],
    forms: [
      { form: "side-walk", tags: ["alternative"] },
      { form: "sidewalke", tags: ["alternative"] },
      { form: "または" }
    ]
  }),
  JSON.stringify({ word: "be", lang_code: "nb", pos: "verb", senses: [{ glosses: ["to ask"] }] })
]

describe("cleanIpa", () => {
  it("keeps real IPA and drops template debris", () => {
    expect(cleanIpa("/en/")).toBeNull()
    expect(cleanIpa("[list]")).toBeNull()
    expect(cleanIpa("//ɪnkənˈviːniənt//")).toBe("/ɪnkənˈviːniənt/")
    expect(cleanIpa("/'bɑðɚ/")).toBe("/ˈbɑðɚ/")
    expect(cleanIpa("[tʰeɪk]")).toBe("[tʰeɪk]")
  })
})

describe("parseEnWiktionary", () => {
  const { words, formsOf, phrases } = parseEnWiktionary(rawEnWiktionary)
  const word = (headword: string) => words.find((candidate) => candidate.headword === headword)

  it("merges a word's parts of speech into one headword and prefers American IPA", () => {
    const eat = word("eat")
    expect(eat?.ipa).toBe("/it/")
    expect(eat?.senses.map((sense) => [sense.glosses, sense.pos, sense.misc, sense.dialects])).toEqual([
      [["To ingest food."], ["v", "vt", "vi"], [], []],
      [["To bother or worry."], ["v", "vt"], ["col"], []],
      [["To consume resources."], ["v"], [], []],
      [["Food."], ["n"], ["col"], ["en-US"]]
    ])
    expect(eat?.senses[1]?.synonyms).toEqual(["bother"])
    expect(eat?.senses[0]?.synonyms).toEqual([])
    expect(eat?.entryJaTranslations).toEqual(["食べる (ingest)"])
  })

  it("preserves multi-word verb inflections on phrases and drops archaic forms while keeping slang inflections", () => {
    expect(word("keep it real")?.inflections).toEqual([
      { text: "keeps it real", tags: ["third-person"] },
      { text: "keeping it real", tags: ["present-participle"] },
      { text: "kept it real", tags: ["past", "past-participle"] }
    ])
    expect(word("slay")?.inflections).toEqual([
      { text: "slays", tags: ["third-person"] },
      { text: "slaying", tags: ["present-participle"] },
      { text: "slew", tags: ["past"] },
      { text: "slayed", tags: ["past", "past-participle"] },
      { text: "slain", tags: ["past-participle"] }
    ])
  })

  it("keeps acronym alt-of senses as standalone entries while turning pure inflection/spelling stubs into formsOf", () => {
    expect(word("GOAT")?.senses.map((s) => [s.glosses, s.misc])).toEqual([
      [["Acronym of greatest of all time."], ["abbr", "sl"]]
    ])
    expect(formsOf).toEqual([
      { text: "tired", base: "tire", tags: ["past", "past-participle"] },
      { text: "ate", base: "eat", tags: ["past"] },
      { text: "judgement", base: "judgment", tags: [] }
    ])
    expect(word("ate")).toBeUndefined()
    expect(word("judgement")).toBeUndefined()
    expect(word("tire")?.inflections).toEqual([{ text: "tired", tags: ["past", "past-participle"] }])
  })

  it("skips malformed lines, non-English entries, and obsolete alternative spellings", () => {
    expect(word("broken")).toBeUndefined()
    expect(word("mistyped")).toBeUndefined()
    expect(word("be")).toBeUndefined()
    expect(word("sidewalk")?.spellings).toEqual(["side-walk"])
    expect([...phrases]).toEqual(["eat out"])
  })

  it("reconstructs ConsolidatedWord from raw senses and model consolidation output", () => {
    const rawKeepItReal = word("keep it real")!
    const consolidated = mergeConsolidatedWord(rawKeepItReal, {
      headword: "keep it real",
      familiarity: 4,
      senses: [
        {
          sourceIndices: [0],
          glosses: ["ありのままでいる", "本音で話す"],
          info: null
        },
        {
          sourceIndices: [1],
          glosses: ["じゃあな", "元気でな"],
          info: "命令形で別れの挨拶として"
        }
      ]
    })
    expect(consolidated).toEqual({
      headword: "keep it real",
      ipa: "/ˈkiːp ɪt ˈɹiːl/",
      familiarity: 4,
      inflections: [
        { text: "keeps it real", tags: ["third-person"] },
        { text: "keeping it real", tags: ["present-participle"] },
        { text: "kept it real", tags: ["past", "past-participle"] }
      ],
      senses: [
        {
          pos: ["v"],
          misc: ["col"],
          glosses: ["ありのままでいる", "本音で話す"],
          synonyms: ["keep it one hundred"]
        },
        {
          pos: ["v"],
          misc: ["col", "id"],
          glosses: ["じゃあな", "元気でな"],
          info: ["命令形で別れの挨拶として"]
        }
      ]
    })
  })
})

describe("toEntries", () => {
  const makeWord = (
    headword: string,
    glosses: Array<Array<string>>,
    extra: Partial<Word> = {}
  ): Word => ({
    headword,
    ipa: null,
    spellings: [],
    inflections: [],
    senses: glosses.map((g) => ({
      ...emptySense(),
      pos: ["v"],
      glosses: g.map((text) => ({ text, type: null }))
    })),
    ...extra
  })

  const frequency = parseFrequency(["eat 5000", "ate 3000", "team 4000", "be 90000", "was 80000"])
  const sampleWords: Array<Word> = [
    makeWord("eat", [["～を食べる"], ["食事をする"], ["心配させる"]], {
      ipa: "/iːt/",
      inflections: [
        { text: "eats", tags: ["third-person", "plural"] },
        { text: "eating", tags: ["present-participle"] },
        { text: "ate", tags: ["past"] },
        { text: "eaten", tags: ["past-participle"] }
      ]
    }),
    makeWord("be", [["…である"]], {
      inflections: [{ text: "was", tags: ["past"] }]
    }),
    makeWord("team", [["チーム"]]),
    makeWord("keep it real", [["ありのままでいる", "本音で話す"]], {
      ipa: "/ˈkiːp ɪt ˈɹiːl/",
      familiarity: 4,
      inflections: [{ text: "kept it real", tags: ["past", "past-participle"] }]
    }),
    makeWord("make sense", [["納得できる"]])
  ]

  it("round-trips consolidated JSONL lines and ranks words by frequency or familiarity fallback", () => {
    const jsonlLines = sampleWords.map((w) => JSON.stringify(toConsolidatedWord(w)))
    const parsed = parseWiktionary(jsonlLines)
    const entries = toEntries(mergeSources({ wiktionary: parsed }), frequency, new Map([["team", 100000007]]))

    expect(entries.map((entry) => [entry.headword, entry.id, entry.priority, entry.common])).toEqual([
      ["be", 100000008, Math.round(20 * Math.log10(170000)), true],
      ["eat", 100000009, Math.round(20 * Math.log10(8000)), true],
      ["team", 100000007, Math.round(20 * Math.log10(4000)), true],
      ["keep it real", 100000010, Math.round(20 * Math.log10(1000)), true],
      ["make sense", 100000011, 0, false]
    ])
  })

  it("places POS-level synonyms on the sense they share a meaning with, and leaves out the rest", () => {
    const placed = mergeSources({
      wiktionary: {
        words: [
          makeWord("eat", [["～を食べる"], ["食事をする"], ["心配させる"]], {
            references: [{ from: 0, to: 3, synonyms: ["dine", "bother", "chow down"], antonyms: ["fast"] }]
          }),
          makeWord("dine", [["食事をとる"]]),
          makeWord("bother", [["悩ます"], ["心配させる"]]),
          makeWord("awkward", [["不器用な"]], {
            references: [{ from: 0, to: 1, synonyms: [], antonyms: ["handy"] }]
          })
        ]
      }
    })
    const entries = toEntries(placed, frequency, new Map())
    const eat = entries.find((entry) => entry.headword === "eat")
    expect(eat?.senses.map((sense) => sense.xrefs)).toEqual([[], ["dine"], ["bother"]])
    expect(eat?.senses.every((sense) => sense.antonyms.length === 0)).toBe(true)
    expect(entries.find((entry) => entry.headword === "awkward")?.senses[0]?.antonyms).toEqual(["handy"])
  })

  it("preserves consolidated sense order while listing rare, dated and obsolete senses last", () => {
    const sense = (glosses: Array<string>, misc: Array<string> = []) => ({
      ...emptySense(),
      glosses: glosses.map((text) => ({ text, type: null })),
      misc
    })
    expect(
      commonestFirst([sense(["満足した"], ["obs"]), sense(["悲しい"]), sense(["気の毒な"])]).map(
        (s) => s.glosses[0]?.text
      )
    ).toEqual(["悲しい", "気の毒な", "満足した"])
  })
})
