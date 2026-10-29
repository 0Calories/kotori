import { assert, layer } from "@effect/vitest"
import { Claude, ExampleWriter } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, JobsRepo, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Jev, JevError, NuanceEnricher } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Enrichers } from "../src/Enrichers.ts"
import { makeJobRunner } from "../src/JobRunner.ts"

// The worker's real enrichers and repositories on PGlite; only the paid providers are fakes.

let jevDown = false

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (_state, questions) => {
      if (jevDown) return Effect.fail(new JevError({ message: "Jev is down" }))
      // Whatever Jev's answer types require: the first option of every choice, a likely first candidate.
      const answer = (name: string, type: string, criteria: object) => {
        switch (type) {
          case "score":
            return { type, score: name === "formality" ? 2 : 1, confidence: 0.9, legend: {}, probabilities: {} }
          case "choice": {
            const choice = name.startsWith("difference_") ? "more_casual" : Object.keys(criteria)[0]!
            return { type, choice, confidence: 0.8, probabilities: {} }
          }
          default:
            return { type, noul: name === "similar_0" ? 0.9 : 0.1 }
        }
      }
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([name, q]) => [
            name,
            answer(name, q.type, ("criteria" in q ? q.criteria : null) ?? {})
          ])
        ),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

const FakeClaude = Layer.succeed(
  Claude,
  Claude.of({
    model: "claude-test",
    available: Effect.succeed(true),
    generate: () =>
      Effect.succeed({
        senses: [
          {
            sense: 0,
            examples: [
              {
                ja: "パンを食べる。",
                furigana: "パンを{食|た}べる。",
                en: "I eat bread.",
                formality: "neutral",
                speaker: { gender: "unspecified", age: "unspecified" },
                medium: "conversation",
                variety: null,
                tone: "neutral",
                note: null
              }
            ]
          }
        ]
      } as never)
  })
)

const spoken: Array<string> = []
const FakeElevenLabs = Layer.succeed(
  ElevenLabs,
  ElevenLabs.of({
    configured: true,
    model: "tts-test",
    synthesize: (text) => Effect.sync(() => (spoken.push(text), new TextEncoder().encode(`mp3:${text}`)))
  })
)

const TestLayer = Enrichers.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      NuanceEnricher.layer.pipe(Layer.provideMerge(FakeJev)),
      ExampleWriter.layer.pipe(Layer.provideMerge(FakeClaude)),
      Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(FakeElevenLabs, AudioStore.layer, FakeJev)))
    )
  ),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseMemory)
)

const sense = (glosses: Array<string>) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1"],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: []
})

const entry = (id: number, headword: string, reading: string, senses: Array<Array<string>>): EntryRecord => ({
  id,
  language: "ja",
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: senses.map(sense)
})

const taberu = 1358280
const kuu = 1269130

/** Runs cycles until the queue has nothing runnable, returning how many jobs ran. */
const drain = (step: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    let ran = 0
    while (yield* step) ran++
    return ran
  })

layer(TestLayer)("kotori work", (it) => {
  it.effect("runs queued enrichment into the new tables, voicing examples once they exist", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      yield* dictionary.insertEntries([
        entry(taberu, "食べる", "たべる", [["to eat"], ["to live on (e.g. a salary)"]]),
        entry(kuu, "食う", "くう", [["to eat"]])
      ])

      const kinds = yield* (yield* Enrichers).available
      assert.deepStrictEqual(kinds, ["nuance", "examples", "audio"])
      const step = yield* makeJobRunner(kinds)

      // What the API does when a learner opens an entry.
      yield* jobs.enqueue("nuance", taberu, 100, 0)
      yield* jobs.enqueue("examples", taberu, 100, 0)
      assert.strictEqual(yield* drain(step), 3)

      assert.deepStrictEqual(
        (yield* enrichment.nuanceFor([taberu])).map((row) => [row.sense, row.model]),
        [
          [0, "jev-test"],
          [1, "jev-test"]
        ]
      )
      assert.deepStrictEqual(
        (yield* enrichment.similarFor(taberu)).map((row) => [row.sense, row.similarId, row.difference]),
        [[0, kuu, "more_casual"]]
      )
      const [example] = yield* enrichment.examplesFor([taberu])
      assert.strictEqual(example?.furigana, "パンを{食|た}べる。")
      assert.strictEqual(example?.model, "claude-test")

      // The audio job was queued by the examples job: headword and sentence are both voiced,
      // the headword once per cast dictionary voice (Kyoko and the announcer), the sentence in
      // Japanese, which is what its learners are learning.
      assert.deepStrictEqual(spoken, ["たべる", "たべる", "パンを食べる。"])
      assert.isTrue((yield* enrichment.entryAudio([taberu])).has(taberu))
      const clips = yield* enrichment.exampleAudio([example!.id])
      assert.deepStrictEqual([...clips.keys()], [`${example!.id}:ja`])
      assert.deepStrictEqual(
        [...(yield* jobs.statusFor(taberu))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "done"],
          ["examples", "done"],
          ["nuance", "done"]
        ]
      )
    })
  )

  it.effect("puts a failed job back with a delay and runs it once that has passed", () =>
    Effect.gen(function* () {
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const step = yield* makeJobRunner(["nuance"])

      jevDown = true
      yield* jobs.enqueue("nuance", kuu, 10, 0)
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobs.statusFor(kuu)).get("nuance"), "queued")
      assert.isFalse(yield* step)

      jevDown = false
      yield* TestClock.adjust("61 seconds")
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobs.statusFor(kuu)).get("nuance"), "done")
      assert.strictEqual((yield* enrichment.nuanceFor([kuu])).length, 1)
    })
  )
})
