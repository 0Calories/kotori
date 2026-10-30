import { assert, describe, it, layer } from "@effect/vitest"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { LOAN_SHOWN } from "@kotori/domain"
import type { Question, Questions } from "@typesafe-ai/sdk"
import { Effect, Layer, Option } from "effect"
import {
  ENGLISH_QUESTIONS_VERSION,
  englishSenseQuestions,
  entryRequest,
  interpretLoan,
  interpretSense,
  Jev,
  loanRequest,
  NuanceEnricher,
  type SenseAnswers,
  senseQuestions,
  senseScope
} from "../src/index.ts"

const score = (value: number, confidence = 0.9) =>
  ({ type: "score", score: value, confidence, legend: {}, probabilities: {} }) as const
const choice = (value: string, confidence = 0.8) =>
  ({ type: "choice", choice: value, confidence, probabilities: {} }) as const
const noul = (value: number) => ({ type: "noul", noul: value }) as const

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
      { loanword_0: noul(0.85), loan_0: choice("diverges", 0.9), loanword_1: noul(0.1), loan_1: choice("matches") },
      asked
    )
    assert.deepStrictEqual(loan, {
      word: "スタイル",
      verdict: { value: "diverges", confidence: 0.9, source: "jev" }
    })
  })

  it("finds no loan when no candidate is likely enough, or there are none", () => {
    const unlikely = {
      loanword_0: noul(0.5),
      loan_0: choice("diverges"),
      loanword_1: noul(0.2),
      loan_1: choice("matches")
    }
    assert.deepStrictEqual(interpretLoan(unlikely, asked), { word: null, verdict: null })
    assert.deepStrictEqual(interpretLoan({}, []), { word: null, verdict: null })
  })

  it("takes JMDict's word for a candidate it names the English word as the source of", () => {
    const loan = interpretLoan({ loanword_0: noul(0.2), loan_0: choice("diverges", 0.7) }, [
      { word: "マンション", by: "source" }
    ])
    assert.strictEqual(loan.word, "マンション")
  })

  it("reads whether a loan misleads as a Noul, its confidence the distance from a coin flip", () => {
    const read = (p: number) => interpretLoan({ loanword_0: noul(0.9), loan_0: noul(p) }, asked).verdict
    assert.strictEqual(read(0.85)?.value, "diverges")
    assert.closeTo(read(0.85)!.confidence, 0.7, 1e-9)
    assert.strictEqual(read(0.2)?.value, "matches")
    assert.closeTo(read(0.2)!.confidence, 0.6, 1e-9)
    assert.closeTo(read(0.5)!.confidence, 0, 1e-9)
    // The thresholds hold at Jev's two decimals: 0.7 and 0.3 are shown.
    assert.isAtLeast(read(0.7)!.confidence, LOAN_SHOWN)
    assert.isAtLeast(read(0.3)!.confidence, LOAN_SHOWN)
    assert.isBelow(read(0.69)!.confidence, LOAN_SHOWN)
  })
})

/** Answers by the name a question is stored under: a request names them `s{sense}_{name}`. */
const fakeAnswer = (key: string, question: Question) => {
  const name = key.replace(/^s\d+_/, "")
  switch (question.type) {
    case "score":
      return score(name === "formality" ? 2 : name === "profanity" ? 0 : 1)
    case "choice":
      return choice(
        name.startsWith("difference_")
          ? "more_casual"
          : name.startsWith("loan_")
            ? "diverges"
            : Object.keys(question.criteria)[0]!
      )
    case "noul":
      // A drifted loan: whatever the dictionary has as an English word's katakana candidate misleads.
      return noul(
        name === "similar_0" || name === "loanword_0" || name.startsWith("loan_")
          ? 0.9
          : name.startsWith("similar_")
            ? 0.2
            : 0.1
      )
  }
}

const requests: Array<{ readonly state: unknown; readonly questions: Questions }> = []

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state: unknown, questions: Questions) => {
      requests.push({ state, questions })
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, fakeAnswer(name, q)])),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

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
  sources: [],
  wasei: false
})

const entry = (id: number, headword: string, reading: string, senses: EntryRecord["senses"]): EntryRecord => ({
  id,
  language: "ja",
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
  id,
  language: "en",
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

const TestLayer = NuanceEnricher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Repositories, FakeJev)),
  Layer.provideMerge(DatabaseMemory)
)

layer(TestLayer)("NuanceEnricher", (it) => {
  it.effect("classifies each sense and keeps near-synonyms", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([
        entry(1, "食べる", "たべる", [sense(["to eat"]), sense(["to live on"])]),
        entry(2, "食う", "くう", [sense(["to eat"], ["male"])]),
        entry(3, "召し上がる", "めしあがる", [sense(["to eat", "to drink"], ["hon"])])
      ])
      yield* dictionary.saveTags([{ code: "v1", label: "Ichidan verb" }])
      requests.length = 0

      // One request for the whole entry: both senses' questions and the candidate comparisons.
      const summary = yield* (yield* NuanceEnricher).enrich(1)
      assert.deepStrictEqual(summary, { senses: 2, similar: 1, loan: null, inputTokens: 100 })
      assert.strictEqual(requests.length, 1)

      // The state is the entry; each question carries the sense it is about.
      const { state, questions } = requests[0]!
      assert.deepStrictEqual(state, { word: "食べる", reading: "たべる (taberu)", senses: ["to eat", "to live on"] })
      const instructions = (key: string) => questions[key]?.instructions as Record<string, unknown>
      assert.strictEqual(instructions("s1_formality")["meaning"], "to live on")
      assert.deepStrictEqual(instructions("s0_keigo")["part_of_speech"], ["Ichidan verb"])
      assert.deepStrictEqual(
        ["s0_similar_0", "s0_similar_1"].map((key) => instructions(key)["candidate_word"]),
        ["食う", "召し上がる"]
      )
      // Similar words are looked for on the main senses; this one's second sense shares no gloss.
      assert.isUndefined(questions["s1_similar_0"])
      // Japanese words have no katakana loan to judge.
      assert.isUndefined(questions["loanword_0"])

      const repo = yield* EnrichmentRepo
      const saved = yield* repo.nuanceFor([1])
      assert.strictEqual(saved.length, 2)
      assert.strictEqual(saved[0]?.nuance.formality.value, "neutral")
      assert.strictEqual(saved[0]?.questionsVersion, 3)
      assert.deepStrictEqual(yield* repo.loanWordsFor([1]), [])

      const similar = yield* repo.similarFor(1)
      assert.deepStrictEqual(
        similar.map((row) => [row.similarId, row.difference]),
        [[2, "more_casual"]]
      )
    })
  )

  it.effect("judges English words in English terms, against other English words, with their loan", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([
        english(100000001, "eat", ["食べる", "食事をする"], ["consume"]),
        english(100000002, "dine", ["食事をする"]),
        english(100000003, "consume", ["消費する"]),
        english(100000004, "style", ["様式", "流儀"]),
        katakana(9100001, "スタイル", ["(one's) figure; physique", "style"])
      ])
      requests.length = 0

      const enricher = yield* NuanceEnricher
      yield* enricher.enrich(100000001)
      const { state, questions } = requests[0]!
      assert.deepStrictEqual(state, { word: "eat", reading: "/iːt/", senses: ["食べる; 食事をする"] })
      const instructions = (key: string) => questions[key]?.instructions as Record<string, unknown>
      // Its Wiktionary synonym first, then the word sharing a gloss (食事をする).
      assert.deepStrictEqual(
        ["s0_similar_0", "s0_similar_1"].map((key) => instructions(key)["candidate_word"]),
        ["consume", "dine"]
      )
      assert.isUndefined(questions["s0_keigo"])
      assert.notProperty((questions["s0_difference_0"] as { criteria: object }).criteria, "respectful")
      assert.include(String(instructions("s0_formality")["focus"]), "translated into Japanese")
      for (const name of ["variety", "profanity", "textbook"]) assert.isDefined(questions[`s0_${name}`])

      const repo = yield* EnrichmentRepo
      const [nuance] = yield* repo.nuanceFor([100000001])
      assert.strictEqual(nuance?.nuance.keigo.value, "none")
      assert.strictEqual(nuance?.nuance.variety?.value, "universal")
      assert.strictEqual(nuance?.nuance.profanity?.value, "none")
      assert.strictEqual(nuance?.questionsVersion, ENGLISH_QUESTIONS_VERSION)

      // "style" has a katakana loan in JMDict: judged once for the word, in a request of its own
      // beside the senses', whose state is the word without its Japanese senses.
      const summary = yield* enricher.enrich(100000004)
      assert.strictEqual(summary.loan, "スタイル")
      assert.strictEqual(summary.inputTokens, 200)
      const [senses, loans] = requests.slice(1)
      assert.isUndefined(senses!.questions["loan_0"])
      assert.deepStrictEqual(loans!.state, { word: "style" })
      assert.deepStrictEqual(Object.keys(loans!.questions), ["loanword_0", "loan_0"])
      const loanAsked = loans!.questions["loan_0"]!.instructions as Record<string, unknown>
      assert.strictEqual(loanAsked["katakana_word"], "スタイル")
      const [loan] = yield* repo.loanWordsFor([100000004])
      assert.deepStrictEqual([loan?.word, loan?.verdict?.value, loan?.trap], ["スタイル", "diverges", null])
      assert.closeTo(loan!.verdict!.confidence, 0.8, 1e-9)
    })
  )

  it.effect("reinterprets stored answers without calling Jev", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([
        entry(4, "走る", "はしる", [sense(["to run"])]),
        english(100000005, "juice", ["果汁", "ジュース"]),
        katakana(9100002, "ジュース", ["juice", "soft drink (usu. fruit-based)"])
      ])
      const enricher = yield* NuanceEnricher
      yield* enricher.enrich(4)
      yield* enricher.enrich(100000005)
      const callsBefore = requests.length

      const repo = yield* EnrichmentRepo
      const [judged] = yield* repo.nuanceFor([4])
      // Corrupt the interpretations; a reinterpretation must rebuild them from the stored answers.
      yield* repo.updateNuance(4, 0, {
        ...judged!.nuance,
        formality: { value: "vulgar", position: 0, confidence: 1, source: "jev" }
      })
      yield* repo.updateLoanWord(100000005, null, null)

      const summary = yield* enricher.reinterpret(4)
      assert.strictEqual(summary.senses, 1)
      const [restored] = yield* repo.nuanceFor([4])
      assert.deepStrictEqual(restored!.nuance, judged!.nuance)
      yield* enricher.reinterpret(100000005)
      const [loan] = yield* repo.loanWordsFor([100000005])
      assert.strictEqual(loan?.word, "ジュース")
      assert.isTrue(Option.isSome(yield* repo.loanAnswersFor(100000005)))
      assert.strictEqual(requests.length, callsBefore)
    })
  )
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
    assert.deepStrictEqual(Object.keys(loans.questions), ["loanword_0", "loan_0"])
    assert.notProperty(loans.state, "senses")
    for (const question of Object.values(loans.questions)) assert.strictEqual(question.type, "noul")
  })
})

void it
