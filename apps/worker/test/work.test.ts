import { assert, layer } from "@effect/vitest"
import { Claude, ExampleWriter } from "@kotori/ai"
import { Database } from "@kotori/db"
import { jobs } from "@kotori/db/schema"
import { DatabaseMemory } from "@kotori/db/testing"
import { Jev } from "@kotori/nuance"
import { Dictionary, Enrichment, makeServices } from "@kotori/services"
import { ElevenLabs, TtsError } from "@kotori/tts"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { makeJobRunner } from "../src/JobRunner.ts"

// The worker's loop over the real services on PGlite. What the enrichment does is the
// services' tests' business; here only Jev is "configured", answering anything at all.

const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (_state, questions) => {
      // Whatever Jev's answer types require: the first option of every choice, unlikely yes/nos.
      const answer = (type: string, criteria: object) => {
        switch (type) {
          case "score":
            return { type, score: 1, confidence: 0.9, legend: {}, probabilities: {} }
          case "choice":
            return { type, choice: Object.keys(criteria)[0]!, confidence: 0.8, probabilities: {} }
          default:
            return { type, noul: 0.1 }
        }
      }
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([name, q]) => [
            name,
            answer(q.type, ("criteria" in q ? q.criteria : null) ?? {})
          ])
        ),
        usage: { input_tokens: 1, output_tokens: 0 }
      } as never)
    }
  })
)

const Unconfigured = Layer.mergeAll(
  ExampleWriter.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(
        Claude,
        Claude.of({ model: "test", available: Effect.succeed(false), generate: () => Effect.die("unused") })
      )
    )
  ),
  Layer.succeed(
    ElevenLabs,
    ElevenLabs.of({
      configured: false,
      model: "test",
      voiceFor: () => "test",
      synthesize: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not configured" }))
    })
  )
)

const TestLayer = makeServices(Layer.merge(FakeJev, Unconfigured), DatabaseMemory)

const kuu = 1269130

layer(TestLayer)("kotori work", (it) => {
  it.effect("puts back a job left running by a worker that died, and runs it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* Dictionary.insertEntries([
        {
          id: kuu,
          headword: "食う",
          reading: "くう",
          common: true,
          priority: 50,
          forms: [],
          senses: [
            {
              glosses: [{ text: "to eat", type: null }],
              pos: ["v5u"],
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
        }
      ])
      yield* Enrichment.enqueue("nuance", kuu, 10)
      // A worker claimed it, then was killed before it could settle it.
      yield* db.update(jobs).set({ status: "running", attempts: 1 }).where(eq(jobs.entryId, kuu))

      const step = makeJobRunner(["nuance"])
      yield* TestClock.adjust("5 minutes")
      // Not stale yet: the first cycle sweeps, but the job could still be running somewhere.
      assert.isFalse(yield* step)
      assert.strictEqual((yield* Enrichment.statusFor(kuu)).get("nuance"), "running")

      yield* TestClock.adjust("6 minutes")
      assert.isTrue(yield* step)
      assert.strictEqual((yield* Enrichment.statusFor(kuu)).get("nuance"), "done")
      assert.isFalse(yield* step)
    })
  )
})
