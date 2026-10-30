import { assert, describe, it, layer } from "@effect/vitest"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import type { Question, Questions } from "@typesafe-ai/sdk"
import { Effect, Layer } from "effect"
import { interpretSense, Jev, NuanceEnricher, type SenseAnswers, senseQuestions } from "../src/index.ts"

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
  })

  it("lets JMDict's usage tags override Jev", () => {
    const nuance = interpretSense(answers, ["hon"])
    assert.deepStrictEqual(nuance.formality, { value: "formal", position: 1, confidence: 1, source: "jmdict" })
    assert.strictEqual(nuance.keigo.value, "sonkeigo")
    assert.strictEqual(nuance.keigo.source, "jmdict")
    assert.strictEqual(interpretSense(answers, ["male", "col"]).gender.value, "masculine")
    assert.strictEqual(interpretSense(answers, ["sl"]).cautions.slang, 1)
  })
})

const fakeAnswer = (name: string, question: Question) => {
  switch (question.type) {
    case "score":
      return score(name === "formality" ? 2 : 1)
    case "choice":
      return choice(name.startsWith("difference_") ? "more_casual" : Object.keys(question.criteria)[0]!)
    case "noul":
      return noul(name === "similar_0" ? 0.9 : name.startsWith("similar_") ? 0.2 : 0.1)
  }
}

const states: Array<unknown> = []

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state: unknown, questions: Questions) => {
      states.push(state)
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
  antonyms: []
})

const entry = (id: number, headword: string, reading: string, senses: EntryRecord["senses"]): EntryRecord => ({
  id,
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
      yield* dictionary.replaceTags([{ code: "v1", label: "Ichidan verb" }])

      // One request per sense carries the Japanese, English-side and candidate questions.
      const summary = yield* (yield* NuanceEnricher).enrich(1)
      assert.deepStrictEqual(summary, { senses: 2, similar: 1, inputTokens: 200 })

      const firstState = states[0] as {
        word: string
        english_word: string
        part_of_speech: Array<string>
        candidates: Array<{ word: string }>
      }
      assert.strictEqual(firstState.word, "食べる")
      assert.strictEqual(firstState.english_word, "to eat")
      assert.deepStrictEqual(firstState.part_of_speech, ["Ichidan verb"])
      assert.deepStrictEqual(
        firstState.candidates.map((c) => c.word),
        ["食う", "召し上がる"]
      )

      const repo = yield* EnrichmentRepo
      const saved = yield* repo.nuanceFor([1])
      assert.strictEqual(saved.length, 2)
      assert.strictEqual(saved[0]?.nuance.formality.value, "neutral")

      // The English-side judgments ride the same request and land in their own table.
      const english = yield* repo.englishNuanceFor([1])
      assert.strictEqual(english.length, 2)
      assert.strictEqual(english[0]?.nuance.loan.value, "no_loan")

      const similar = yield* repo.similarFor(1)
      assert.deepStrictEqual(
        similar.map((row) => [row.similarId, row.difference]),
        [[2, "more_casual"]]
      )
    })
  )

  it.effect("reinterprets stored answers without calling Jev", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      yield* dictionary.insertEntries([entry(4, "走る", "はしる", [sense(["to run"])])])
      const enricher = yield* NuanceEnricher
      yield* enricher.enrich(4)

      const repo = yield* EnrichmentRepo
      const [judged] = yield* repo.nuanceFor([4])
      // Corrupt the interpretation; a reinterpretation must rebuild it from the stored answers.
      yield* repo.updateNuance(4, 0, {
        ...judged!.nuance,
        formality: { value: "vulgar", position: 0, confidence: 1, source: "jev" }
      })

      const summary = yield* enricher.reinterpret(4)
      assert.strictEqual(summary.senses, 1)
      const [restored] = yield* repo.nuanceFor([4])
      assert.deepStrictEqual(restored!.nuance, judged!.nuance)
    })
  )
})

describe("questions", () => {
  it("ask one narrow judgment each, referring to the state by path", () => {
    for (const question of Object.values(senseQuestions)) {
      assert.include(JSON.stringify(question.instructions), "`word`")
    }
  })
})

void it
