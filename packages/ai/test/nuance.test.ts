import { assert, describe, it } from "@effect/vitest"
import { EntryId, type EntryRecord, type LoanMeaning, loanShown } from "@kotori/contracts"
import type { Question } from "@typesafe-ai/sdk"
import {
  awaitsWarning,
  englishSenseQuestions,
  entryRequest,
  interpretLoan,
  interpretSense,
  loanRequest,
  REVERSED,
  type SenseAnswers,
  senseQuestions,
  senseScope
} from "../src/index.ts"

const score = (value: number, confidence = 0.9) =>
  ({ type: "score", score: value, confidence, legend: {}, probabilities: {} }) as const
const choice = (value: string, confidence = 0.8) =>
  ({ type: "choice", choice: value, confidence, probabilities: {} }) as const
const noul = (value: number) => ({ type: "noul", noul: value }) as const
/** A loan's Choice, `p` on the meaning Jev picks. */
const meaning = (value: LoanMeaning, p: number) =>
  ({
    type: "choice",
    choice: value,
    confidence: (3 * p - 1) / 2,
    probabilities: { same: 0, divergent: 0, not_english: 0, [value]: p }
  }) as const
/** The `k`th candidate's loan Choice, asked in both option orders, the same answer each way. */
const loanAnswers = (k: number, value: LoanMeaning, p: number) => ({
  [`loan_${k}`]: meaning(value, p),
  [`loan_${k}${REVERSED}`]: meaning(value, p)
})

const answers = {
  formality: score(2.2),
  medium: score(1),
  keigo: choice("none"),
  gender: choice("neutral"),
  age: choice("any"),
  currency: choice("current"),
  connotation: choice("neutral"),
  rudeToSuperiors: noul(0.1),
  stiffWithFriends: noul(0.05),
  slang: noul(0.02)
} as unknown as SenseAnswers

describe("interpretSense", () => {
  it("maps Jev's scores onto labelled scales", () => {
    const nuance = interpretSense(answers, [])
    assert.strictEqual(nuance.formality.value, "neutral")
    assert.closeTo(nuance.formality.position, 0.55, 1e-9)
    assert.strictEqual(nuance.formality.source, "jev")
    assert.strictEqual(nuance.medium.value, "both")
  })

  it("maps the register shape, leaving it absent on answers recorded before it existed", () => {
    const shaped = interpretSense({ ...answers, registerShape: choice("split", 0.8) }, [])
    assert.strictEqual(shaped.registerShape?.value, "split")
    assert.strictEqual(interpretSense(answers, []).registerShape, undefined)
    const forced = interpretSense({ ...answers, registerShape: choice("scaled", 0.8) }, ["derog"])
    assert.strictEqual(forced.registerShape?.value, "fixed")
    assert.strictEqual(forced.registerShape?.source, "jmdict")
  })

  it("derives the stiff-between-friends caution from how likely a stiff register is", () => {
    const stiff = (overrides: Partial<Record<"formality" | "medium" | "keigo", unknown>>, misc: Array<string> = []) =>
      interpretSense({ ...answers, ...overrides } as SenseAnswers, misc).cautions.stiffWithFriends
    assert.strictEqual(stiff({}), 0)
    assert.closeTo(stiff({ formality: { ...score(3.7, 0.5), probabilities: { 3: 0.3, 4: 0.7 } } }), 0.7, 1e-9)
    assert.closeTo(stiff({ medium: { ...score(1.8, 0.6), probabilities: { 1: 0.2, 2: 0.8 } } }), 0.8, 1e-9)
    // Unsure which keigo it is, but sure it is keigo: low confidence, high probability.
    const split = { ...choice("sonkeigo", 0.3), probabilities: { sonkeigo: 0.5, kenjougo: 0.45, none: 0.05 } }
    assert.closeTo(stiff({ keigo: split }), 0.95, 1e-9)
    // A JMDict tag decides outright, either way.
    assert.strictEqual(stiff({}, ["hon"]), 1)
    assert.strictEqual(stiff({ keigo: split }, ["pol"]), 0)
    // A field's term is written because of its subject: "tension" in physics isn't stiff among friends.
    const written = { medium: { ...score(1.9, 0.8), probabilities: { 1: 0.1, 2: 0.9 } } }
    const physics = (formality = answers.formality) =>
      interpretSense({ ...answers, ...written, formality }, [], ["physics"]).cautions.stiffWithFriends
    assert.closeTo(physics(), 0, 1e-9)
    assert.closeTo(physics({ ...score(3.8, 0.6), probabilities: { 3: 0.2, 4: 0.8 } }), 0.8, 1e-9)
  })

  it("lets JMDict's usage tags override Jev", () => {
    const nuance = interpretSense(answers, ["hon"])
    assert.deepStrictEqual(nuance.formality, { value: "formal", position: 1, confidence: 1, source: "jmdict" })
    assert.strictEqual(nuance.keigo.value, "sonkeigo")
    assert.strictEqual(nuance.keigo.source, "jmdict")
    assert.strictEqual(interpretSense(answers, ["male", "col"]).gender.value, "masculine")
    assert.strictEqual(interpretSense(answers, ["sl"]).cautions.slang, 1)
  })

  it("judges English words without keigo, with their variety, profanity and textbook caution", () => {
    const { keigo: _, ...english } = answers
    const plain = interpretSense(english, [])
    assert.deepStrictEqual(plain.keigo, { value: "none", confidence: 1, source: "jmdict" })
    assert.strictEqual(plain.variety, undefined)
    assert.strictEqual(plain.cautions.textbook, undefined)

    const judged = interpretSense(
      { ...english, variety: choice("universal"), profanity: score(2.2, 0.7), textbook: noul(0.8) },
      []
    )
    assert.strictEqual(judged.variety?.value, "universal")
    assert.deepStrictEqual(judged.profanity, { value: "strong", confidence: 0.7, source: "jev" })
    assert.strictEqual(judged.cautions.textbook, 0.8)
    // The English dictionary's regions and Wiktionary's labels, in JMDict's codes, decide.
    const tagged = interpretSense({ ...english, variety: choice("universal") }, ["en-GB", "col"])
    assert.deepStrictEqual(tagged.variety, { value: "british", confidence: 1, source: "jmdict" })
    assert.strictEqual(tagged.formality.value, "casual")
  })
})

describe("interpretLoan", () => {
  const asked = [
    { word: "スタイル", by: "gloss" },
    { word: "タイプ", by: "gloss" }
  ] as const

  it("takes the likeliest candidate to be the loanword, with Jev's verdict on it", () => {
    const loan = interpretLoan(
      {
        loanword_0: noul(0.85),
        ...loanAnswers(0, "divergent", 0.9),
        loanword_1: noul(0.1),
        ...loanAnswers(1, "same", 0.8)
      },
      asked
    )
    assert.deepStrictEqual(loan, {
      word: "スタイル",
      verdict: { value: "divergent", probability: 0.9, source: "jev" }
    })
  })

  it("finds no loan when no candidate is likely enough, or there are none", () => {
    const unlikely = {
      loanword_0: noul(0.5),
      ...loanAnswers(0, "divergent", 0.9),
      loanword_1: noul(0.2),
      ...loanAnswers(1, "same", 0.9)
    }
    assert.deepStrictEqual(interpretLoan(unlikely, asked), { word: null, verdict: null })
    assert.deepStrictEqual(interpretLoan({}, []), { word: null, verdict: null })
  })

  it("takes JMDict's word for a candidate it names the English word as the source of", () => {
    const loan = interpretLoan({ loanword_0: noul(0.2), ...loanAnswers(0, "divergent", 0.7) }, [
      { word: "マンション", by: "source" }
    ])
    assert.strictEqual(loan.word, "マンション")
  })

  it("shows the meaning Jev picks at p ≥ 0.7, as a warning or a chip, and never one not from English", () => {
    const read = (value: LoanMeaning, p: number) =>
      interpretLoan({ loanword_0: noul(0.9), ...loanAnswers(0, value, p) }, asked).verdict!
    // The probability of the meaning, not the Choice's confidence: 0.55 at p = 0.7.
    assert.deepStrictEqual(read("divergent", 0.7), { value: "divergent", probability: 0.7, source: "jev" })
    assert.strictEqual(loanShown(read("divergent", 0.7)), "warning")
    assert.isNull(loanShown(read("divergent", 0.69)))
    assert.strictEqual(loanShown(read("same", 0.7)), "chip")
    assert.isNull(loanShown(read("same", 0.69)))
    assert.isNull(loanShown(read("not_english", 0.95)))
    // Claude writes a warning for what the app shows as one, once.
    const stored = (verdict: ReturnType<typeof read>, trap: string | null = null) => ({
      word: "スタイル",
      verdict,
      trap
    })
    assert.isTrue(awaitsWarning(stored(read("divergent", 0.7))))
    assert.isFalse(awaitsWarning(stored(read("divergent", 0.7), "体型の意味です。")))
    assert.isFalse(awaitsWarning(stored(read("divergent", 0.69))))
    assert.isFalse(awaitsWarning(stored(read("same", 0.9))))
  })

  it("averages each meaning over the Choice asked in both option orders", () => {
    const choiceOf = (same: number, divergent: number, notEnglish: number) => ({
      type: "choice",
      choice: divergent > same ? "divergent" : "same",
      confidence: 0,
      probabilities: { same, divergent, not_english: notEnglish }
    })
    // Forward leans same, reversed divergent: divergent is likelier together, but not enough to show.
    const split = interpretLoan(
      {
        loanword_0: noul(0.9),
        loan_0: choiceOf(0.6, 0.4, 0),
        [`loan_0${REVERSED}`]: choiceOf(0.1, 0.9, 0)
      },
      asked
    ).verdict!
    assert.strictEqual(split.value, "divergent")
    assert.closeTo(split.probability, 0.65, 1e-9)
    assert.isNull(loanShown(split))
    // One order alone isn't a verdict.
    const forwardOnly = { loanword_0: noul(0.9), loan_0: meaning("divergent", 0.9) }
    assert.deepStrictEqual(interpretLoan(forwardOnly, asked), { word: null, verdict: null })
  })
})

const sense = (glosses: Array<string>, misc: Array<string> = []) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1"],
  misc,
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  origins: [],
  wasei: false
})

const entry = (id: number, headword: string, reading: string, senses: EntryRecord["senses"]): EntryRecord => ({
  id: EntryId.make(id),
  language: "ja",
  source: "jmdict",
  headword,
  reading,
  common: true,
  priority: 100 - id,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses
})

/** An English word with Japanese glosses: its IPA, when the dictionary has one, as its reading. */
const english = (id: number, headword: string, glosses: Array<string>, xrefs: Array<string> = []): EntryRecord => ({
  id: EntryId.make(id),
  language: "en",
  source: "enwiktionary",
  headword,
  reading: headword === "eat" ? "/iːt/" : "",
  common: true,
  priority: 50,
  forms: [
    { kind: "spelling", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [{ ...sense(glosses), pos: ["v"], xrefs }]
})

/** A katakana word, the way JMDict has loanwords. */
const katakana = (id: number, headword: string, glosses: Array<string>): EntryRecord => ({
  ...entry(id, headword, headword, [sense(glosses)]),
  forms: [{ kind: "kana", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }]
})

describe("questions", () => {
  it("ask one narrow judgment each, referring to the state by path", () => {
    for (const question of [...Object.values(senseQuestions), ...Object.values(englishSenseQuestions)]) {
      assert.include(JSON.stringify(question.instructions), "`word`")
    }
  })

  it("ask about English words in English terms", () => {
    for (const question of Object.values(englishSenseQuestions)) {
      assert.include(JSON.stringify(question.instructions), "English")
      assert.notInclude(JSON.stringify(question), "Japanese word")
    }
  })

  it("carry their sense's scope, whose keys never repeat a state key", () => {
    const taberu = entry(1, "食べる", "たべる", [sense(["to eat"], ["col"]), sense(["to live on"])])
    const style = english(100000004, "style", ["様式", "流儀"])
    const tags = new Map([["col", "colloquial"]])
    const japanese = entryRequest(taberu, tags)
    assert.deepStrictEqual(
      Object.keys(japanese.questions).filter((key) => key.endsWith("_formality")),
      ["s0_formality", "s1_formality"]
    )
    assert.deepStrictEqual(senseScope(taberu, 0, tags).dictionary_notes, ["colloquial"])
    const englishRequest = entryRequest(style, tags)
    for (const [request, set] of [
      [japanese, senseQuestions],
      [englishRequest, englishSenseQuestions]
    ] as const) {
      for (const [key, question] of Object.entries(request.questions)) {
        const own = question.instructions as Record<string, unknown>
        const name = key.replace(/^s\d+_/, "")
        assert.strictEqual(own["question"], (set as Record<string, Question>)[name]?.instructions)
        assert.include(String(own["focus"]), "`senses`")
        for (const field of Object.keys(own)) assert.notProperty(request.state, field)
      }
    }
    // An English word's loan candidates are asked about once, in a request without its senses.
    const loans = loanRequest(style, [katakana(9100001, "スタイル", ["(one's) figure", "style"])], tags)
    assert.deepStrictEqual(Object.keys(loans.questions), ["loanword_0", "loan_0", `loan_0${REVERSED}`])
    assert.notProperty(loans.state, "senses")
    assert.strictEqual(loans.questions["loanword_0"]?.type, "noul")
    const meanings = loans.questions["loan_0"] as { readonly type: string; readonly criteria: object }
    assert.strictEqual(meanings.type, "choice")
    assert.deepStrictEqual(Object.keys(meanings.criteria), ["same", "divergent", "not_english"])
    // Asked again with its options reversed, since Jev leans toward the first.
    const reversed = loans.questions[`loan_0${REVERSED}`] as {
      readonly criteria: object
      readonly instructions: unknown
    }
    assert.deepStrictEqual(Object.keys(reversed.criteria), ["not_english", "divergent", "same"])
    assert.deepStrictEqual(reversed.instructions, loans.questions["loan_0"]?.instructions)
  })
})

void it
