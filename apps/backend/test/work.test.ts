import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError, ElevenLabs, ExampleWriter, Jev, Pronouncer } from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { jobs } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Clock, Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "../src/db/Database.ts"
import { AudioStore } from "../src/features/audio/AudioStore.ts"
import { entryClips, exampleClips } from "../src/features/audio/queries.ts"
import { Speech } from "../src/features/audio/Speech.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { AudioEnricher } from "../src/features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../src/features/enrichment/Enrichers.ts"
import { enqueueJob, jobStatusFor } from "../src/features/enrichment/jobs.ts"
import { examplesFor } from "../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"
import { makeJobRunner } from "../src/worker/JobRunner.ts"

// The worker's real enrichers and queries on PGlite; only the paid providers are fakes.

/** The parts of a Jev question the fake reads. */
interface Asked {
  readonly type: string
  readonly criteria?: unknown
}

/** Whatever Jev's answer types require: a neutral score, the first option of every choice. */
const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (_state, questions) => {
      const answer = (question: Asked) =>
        question.type === "score"
          ? { type: "score", score: 2, confidence: 0.9, legend: {}, probabilities: {} }
          : question.type === "choice"
            ? { type: "choice", choice: Object.keys(question.criteria ?? {})[0]!, confidence: 0.8, probabilities: {} }
            : { type: "noul", noul: 0.1 }
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, answer(q)])),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

let claudeDown = false
/**
 * When set, Claude never answers, as a hung request would if it had no deadline of its own, and
 * this is completed once a request has started.
 */
let claudeHangs: Deferred.Deferred<void> | null = null
/** Whether the Claude probe succeeds: false as with no key, a bad one, or a probe that timed out. */
let claudeUp = true
const prompts: Array<string> = []

const FakeClaude = Layer.succeed(
  Claude,
  Claude.of({
    model: "claude-test",
    available: Effect.sync(() => claudeUp),
    generate: (options) => {
      if (claudeDown) return Effect.fail(new ClaudeError({ reason: "unavailable", message: "Claude is down" }))
      if (claudeHangs !== null) return Deferred.succeed(claudeHangs, undefined).pipe(Effect.andThen(Effect.never))
      prompts.push(options.prompt)
      return Effect.succeed({
        senses: [
          {
            sense: 0,
            examples: [
              {
                gloss: "to eat",
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
    }
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
  Layer.provideMerge(AudioEnricher.layer),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(Layer.mergeAll(AudioStore.database, ExampleWriter.layer, Pronouncer.layer)),
  Layer.provideMerge(Layer.mergeAll(FakeJev, FakeClaude, FakeElevenLabs)),
  Layer.provideMerge(DatabaseMemory)
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
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses
})

const taberu = EntryId.make(1358280)
const kuu = EntryId.make(1269130)

/** Runs cycles until the queue has nothing runnable, returning how many jobs ran. */
const drain = (step: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    let ran = 0
    while (yield* step) ran++
    return ran
  })

layer(TestLayer)("the worker", (it) => {
  it.effect("writes example sentences, then voices them", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        entry(taberu, "食べる", "たべる", [sense(["to eat"]), sense(["to live on (e.g. a salary)"])]),
        entry(kuu, "食う", "くう", [sense(["to eat"], ["male"])])
      ])

      assert.deepStrictEqual(yield* (yield* Enrichers).available, ["examples", "audio"])
      const step = yield* makeJobRunner()

      // What the API does when a learner opens an entry.
      yield* enqueueJob(db, "examples", taberu, 100, new Date(0))
      assert.strictEqual(yield* drain(step), 2)

      const [example] = yield* examplesFor(db, [taberu])
      assert.strictEqual(example?.furigana, "パンを{食|た}べる。")
      assert.strictEqual(example?.model, "claude-test")

      // The audio job was queued by the examples job: headword and sentence are both voiced,
      // the headword once per cast dictionary voice (Kyoko and the announcer), the sentence in
      // Japanese, which is what its learners are learning.
      assert.deepStrictEqual(spoken, ["たべる", "たべる", "パンを食べる。"])
      assert.isTrue((yield* entryClips(db, [taberu])).has(taberu))
      const clips = yield* exampleClips(db, [example!.id])
      assert.deepStrictEqual([...clips.keys()], [`${example!.id}:ja`])
      assert.deepStrictEqual(
        [...(yield* jobStatusFor(db, taberu))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "done"],
          ["examples", "done"]
        ]
      )
    })
  )

  it.effect("tells the writer the dictionary's own labels as the sense's register", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const step = yield* makeJobRunner()
      yield* enqueueJob(db, "examples", kuu, 100, new Date(0))
      // The examples job, then the audio job it hands its sentences to.
      assert.strictEqual(yield* drain(step), 2)
      assert.include(prompts.at(-1)!, "0. to eat\n   part of speech: v1\n   notes: male")
    })
  )

  it.effect("puts a failed job back with a delay and runs it once that has passed", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [entry(1000001, "飲む", "のむ", [sense(["to drink"])])])
      const nomu = EntryId.make(1000001)
      const step = yield* makeJobRunner()

      claudeDown = true
      yield* enqueueJob(db, "examples", nomu, 10, new Date(0))
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobStatusFor(db, nomu)).get("examples"), "queued")
      assert.isFalse(yield* step)

      claudeDown = false
      yield* TestClock.adjust("61 seconds")
      assert.isTrue(yield* step)
      assert.strictEqual((yield* jobStatusFor(db, nomu)).get("examples"), "done")
    })
  )

  it.effect("claims a kind whose provider was unavailable when the worker started once it is back", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const nabe = EntryId.make(1000)
      yield* insertEntries(db, [entry(nabe, "鍋", "なべ", [sense(["pot"])])])
      // Nothing left over from earlier tests for the runner to claim.
      yield* drain(yield* makeJobRunner())
      // The worker starts while the Claude probe fails, as it can during a deploy.
      claudeUp = false
      const step = yield* makeJobRunner()

      yield* enqueueJob(db, "examples", nabe, 100, new Date(0))
      assert.isFalse(yield* step)
      assert.strictEqual((yield* jobStatusFor(db, nabe)).get("examples"), "queued")

      // Claude is back: the same runner picks the job up, and voices the new examples too.
      claudeUp = true
      assert.strictEqual(yield* drain(step), 2)
      assert.deepStrictEqual(
        [...(yield* jobStatusFor(db, nabe))].sort(([a], [b]) => a.localeCompare(b)),
        [
          ["audio", "done"],
          ["examples", "done"]
        ]
      )
    })
  )

  /** The examples job for a fresh entry, its runner, and a way to read the job back. */
  const hangingJob = (id: number, headword: string) =>
    Effect.gen(function* () {
      const db = yield* Database
      const entryId = EntryId.make(id)
      yield* insertEntries(db, [entry(entryId, headword, headword, [sense(["test"])])])
      yield* drain(yield* makeJobRunner())
      const step = yield* makeJobRunner()
      const started = yield* Deferred.make<void>()
      claudeHangs = started
      yield* enqueueJob(db, "examples", entryId, 100, new Date(0))
      const job = db
        .select({ status: jobs.status, attempts: jobs.attempts, error: jobs.error, runAfter: jobs.runAfter })
        .from(jobs)
        .where(eq(jobs.entryId, entryId))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0]!)
        )
      return { step, started, job }
    })

  it.effect("fails a job that overruns its deadline and retries it with backoff, rather than leave it running", () =>
    Effect.gen(function* () {
      const { step, started, job } = yield* hangingJob(1000002, "遅い")
      const claimedAt = yield* Clock.currentTimeMillis
      const running = yield* Effect.forkChild(step)
      yield* Deferred.await(started)
      assert.strictEqual((yield* job).status, "running")

      // Nothing happens before the deadline, and the stale-job sweep (10 minutes) never sees it.
      yield* TestClock.adjust("7 minutes")
      assert.isUndefined(running.pollUnsafe())
      yield* TestClock.adjust("1 minute")
      assert.isTrue(yield* Fiber.join(running))

      const failed = yield* job
      assert.strictEqual(failed.status, "queued")
      assert.strictEqual(failed.attempts, 1)
      assert.include(failed.error ?? "", "TimeoutError")
      // Retried after the first backoff (30 s doubled once), counted from when it failed.
      assert.strictEqual(failed.runAfter.getTime(), claimedAt + 8 * 60_000 + 60_000)
    }).pipe(Effect.ensuring(Effect.sync(() => (claudeHangs = null))))
  )

  it.effect("puts an interrupted job back in the queue without counting it as a failure", () =>
    Effect.gen(function* () {
      const { step, started, job } = yield* hangingJob(1000003, "止め")
      const running = yield* Effect.forkChild(step)
      yield* Deferred.await(started)

      // A shutdown (SIGTERM during a deploy) while the job runs.
      yield* TestClock.adjust("1 minute")
      yield* Fiber.interrupt(running)

      const released = yield* job
      assert.strictEqual(released.status, "queued")
      assert.strictEqual(released.attempts, 0)
      assert.isNull(released.error)
      assert.strictEqual(released.runAfter.getTime(), 0)
    }).pipe(Effect.ensuring(Effect.sync(() => (claudeHangs = null))))
  )
})
