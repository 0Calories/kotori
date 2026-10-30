import { assert, describe, it, layer } from "@effect/vitest"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import type { Question, Questions } from "@typesafe-ai/sdk"
import { Effect, Layer } from "effect"
import { EnglishEnricher, englishRequest, interpretEnglish, Jev, MAX_GLOSSES } from "../src/index.ts"

const sense = (glosses: Array<string>, extra: Partial<EntryRecord["senses"][number]> = {}) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["n"],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  sources: [],
  wasei: false,
  ...extra
})

const entry = (id: number, headword: string, reading: string, senses: EntryRecord["senses"]): EntryRecord => ({
  id,
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [{ kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }],
  senses
})

const yoshiki = entry(1545830, "様式", "ようしき", [sense(["style", "form", "pattern", "mode", "manner"])])
const style = entry(1069520, "スタイル", "スタイル", [
  sense(["(one's) figure", "physique"], { misc: ["col"] }),
  sense(["style"])
])
const type = entry(1075940, "タイプ", "タイプ", [sense(["type", "kind", "sort", "style"])])

const noul = (value: number) => ({ type: "noul", noul: value })
const choice = (value: string, confidence = 0.8) => ({ type: "choice", choice: value, confidence, probabilities: {} })
const score = (value: number) => ({ type: "score", score: value, confidence: 0.9, legend: {}, probabilities: {} })

describe("englishRequest", () => {
  const tags = new Map([["col", "colloquial"]])
  const { state, questions } = englishRequest(yoshiki, tags, (judged) =>
    judged.gloss === 0 ? [{ entry: style, by: "gloss" as const }] : []
  )

  it("asks about each leading gloss, carrying the gloss and its sense in the instructions", () => {
    assert.deepStrictEqual(state, { word: "様式", reading: "ようしき (youshiki)", senses: ["style; form; pattern"] })
    const glosses = new Set(Object.keys(questions).map((key) => key.split("_").slice(0, 2).join("_")))
    assert.deepStrictEqual([...glosses], ["s0_g0", "s0_g1", "s0_g2", "s0_g3"].slice(0, MAX_GLOSSES))
    const own = (key: string) => questions[key]?.instructions as Record<string, unknown>
    assert.strictEqual(own("s0_g1_variety")["english_word"], "form")
    assert.strictEqual(own("s0_g1_variety")["meaning"], "style; form; pattern; mode; manner")
    // Strength and register are spectra, so Scores; the slur level is strength's own top level.
    assert.strictEqual(questions["s0_g0_strength"]?.type, "score")
    assert.strictEqual(questions["s0_g0_register"]?.type, "score")
    for (const [, question] of Object.entries(questions)) {
      for (const field of Object.keys(question.instructions as object)) assert.notProperty(state, field)
    }
  })

  it("asks whether each katakana candidate is the loan, and whether its meaning matches", () => {
    assert.deepStrictEqual(
      Object.keys(questions).filter((key) => key.includes("loan")),
      ["s0_g0_loanword_0", "s0_g0_loan_0"]
    )
    const pair = questions["s0_g0_loan_0"]?.instructions as Record<string, unknown>
    assert.strictEqual(pair["katakana_word"], "スタイル")
    // The dictionary's translations, with each sense's usage notes, tell everyday senses apart.
    assert.deepStrictEqual(pair["katakana_meanings"], ["(one's) figure; physique [colloquial]", "style"])
    assert.strictEqual(pair["english_word"], "style")
  })
})

describe("interpretEnglish", () => {
  const base = { variety: choice("universal"), strength: score(2.2), currency: choice("current"), register: score(0.4) }

  it("rounds the Scores to their levels", () => {
    const { judgments } = interpretEnglish(base, [])
    assert.strictEqual(judgments.strength.value, "strong")
    assert.strictEqual(judgments.register.value, "casual")
  })

  it("keeps the likeliest candidate Jev judges to be the loan", () => {
    const answers = {
      ...base,
      loanword_0: noul(0.3),
      loan_0: choice("matches"),
      loanword_1: noul(0.9),
      loan_1: choice("diverges", 0.7)
    }
    const read = interpretEnglish(answers, [
      { word: "タイプ", by: "gloss" },
      { word: "スタイル", by: "gloss" }
    ])
    assert.deepStrictEqual(read.judgments.loan, { value: "diverges", confidence: 0.7, source: "jev" })
    assert.strictEqual(read.loanWord, "スタイル")
  })

  it("finds no loan when no candidate is likely the loan, or the dictionary has none", () => {
    const unlikely = interpretEnglish({ ...base, loanword_0: noul(0.6), loan_0: choice("diverges") }, [
      { word: "トラック", by: "gloss" }
    ])
    assert.strictEqual(unlikely.judgments.loan.value, "no_loan")
    assert.closeTo(unlikely.judgments.loan.confidence, 0.4, 1e-9)
    assert.isNull(unlikely.loanWord)
    assert.deepStrictEqual(interpretEnglish(base, []).judgments.loan, {
      value: "no_loan",
      confidence: 1,
      source: "jmdict"
    })
  })

  it("takes JMDict's word that the katakana word is the English word's loan", () => {
    const sourced = interpretEnglish({ ...base, loanword_0: noul(0.6), loan_0: choice("diverges") }, [
      { word: "カンニング", by: "source" }
    ])
    assert.strictEqual(sourced.judgments.loan.value, "diverges")
    assert.strictEqual(sourced.loanWord, "カンニング")
  })
})

// The enricher on PGlite with a fake Jev that judges every candidate a loan and スタイル drifted.
const asked: Array<Questions> = []
const answerFor = (key: string, question: Question) => {
  const name = key.replace(/^s\d+_g\d+_/, "")
  const katakana = (question.instructions as { katakana_word?: string } | null)?.katakana_word
  switch (question.type) {
    case "score":
      return score(name === "strength" ? 0 : 1)
    case "choice":
      return choice(
        name.startsWith("loan_") && katakana === "スタイル" ? "diverges" : Object.keys(question.criteria)[0]!
      )
    case "noul":
      return noul(katakana === "スタイル" ? 0.9 : 0.2)
  }
}
const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (_state: unknown, questions: Questions) => {
      asked.push(questions)
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, answerFor(key, q)])),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

const TestLayer = EnglishEnricher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Repositories, FakeJev)),
  Layer.provideMerge(DatabaseMemory)
)

layer(TestLayer)("EnglishEnricher", (it) => {
  it.effect("judges each leading gloss in one request, the loan chosen from the dictionary's candidates", () =>
    Effect.gen(function* () {
      yield* (yield* DictionaryRepo).insertEntries([yoshiki, style, type])
      const enricher = yield* EnglishEnricher
      const summary = yield* enricher.enrich(yoshiki.id)
      assert.deepStrictEqual(summary, { glosses: MAX_GLOSSES, loans: 1, inputTokens: 100 })
      assert.strictEqual(asked.length, 1)
      // "style" has two katakana candidates; タイプ isn't its loan, スタイル is.
      assert.deepStrictEqual(
        Object.keys(asked[0]!).filter((key) => key.startsWith("s0_g0_loanword_")),
        ["s0_g0_loanword_0", "s0_g0_loanword_1"]
      )

      const repo = yield* EnrichmentRepo
      const rows = yield* repo.englishNuanceFor([yoshiki.id])
      assert.deepStrictEqual(
        rows.map((row) => [row.gloss, row.nuance.loan.value, row.loanWord]),
        [
          [0, "diverges", "スタイル"],
          [1, "no_loan", null],
          [2, "no_loan", null],
          [3, "no_loan", null]
        ]
      )
      assert.strictEqual(rows[0]?.nuance.strength.value, "none")

      // Reinterpretation re-derives the loan from the stored answers and the candidates they name.
      yield* repo.updateEnglishNuance(yoshiki.id, 0, 0, { ...rows[0]!.nuance, loan: rows[1]!.nuance.loan }, null)
      assert.deepStrictEqual(yield* enricher.reinterpret(yoshiki.id), { glosses: MAX_GLOSSES })
      const [restored] = yield* repo.englishNuanceFor([yoshiki.id])
      assert.deepStrictEqual([restored?.nuance, restored?.loanWord], [rows[0]?.nuance, "スタイル"])
    })
  )
})

void it
