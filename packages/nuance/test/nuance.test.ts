import { assert, describe, it, layer } from "@effect/vitest"
import type { EntryRecord } from "@kotori/jmdict"
import type { Question, Questions } from "@typesafe-ai/sdk"
import { Effect, Layer } from "effect"
import { interpretSense, Jev, judgeEntry, type SenseAnswers, senseQuestions } from "../src/index.ts"

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

const candidate = (entryId: number, word: string, reading: string, meaning: string) => ({
  entryId,
  word,
  reading,
  meaning
})

layer(FakeJev)("judgeEntry", (it) => {
  it.effect("judges each sense and keeps the candidates Jev finds near-synonyms", () =>
    Effect.gen(function* () {
      const taberu = entry(1, "食べる", "たべる", [sense(["to eat"]), sense(["to live on"])])
      const judgment = yield* judgeEntry(taberu, new Map([["v1", "Ichidan verb"]]), [
        [candidate(2, "食う", "くう", "to eat"), candidate(3, "召し上がる", "めしあがる", "to eat; to drink")]
      ])

      assert.deepStrictEqual(
        judgment.senses.map((s) => [s.sense, s.nuance.formality.value, s.model]),
        [
          [0, "neutral", "jev-test"],
          [1, "neutral", "jev-test"]
        ]
      )
      assert.deepStrictEqual(
        judgment.similar.map((s) => [s.sense, s.similarId, s.difference]),
        [[0, 2, "more_casual"]]
      )
      assert.strictEqual(judgment.inputTokens, 200)

      const [first, second] = states as Array<{
        word: string
        part_of_speech: Array<string>
        candidates?: Array<{ word: string }>
      }>
      assert.strictEqual(first?.word, "食べる")
      assert.deepStrictEqual(first?.part_of_speech, ["Ichidan verb"])
      assert.deepStrictEqual(
        first?.candidates?.map((c) => c.word),
        ["食う", "召し上がる"]
      )
      // A sense without candidates is asked about its nuance alone.
      assert.isUndefined(second?.candidates)
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
