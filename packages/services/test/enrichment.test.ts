import { assert, layer } from "@effect/vitest"
import { Database } from "@kotori/db"
import { jobs } from "@kotori/db/schema"
import { EntryId } from "@kotori/domain"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Fiber, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { entryClips, exampleClips } from "../src/enrichment/audio.ts"
import { Dictionary, Enrichment } from "../src/index.ts"
import { entry, jev, OfflineElevenLabs, sense, servicesWith, spoken } from "./fixtures.ts"

// The real enrichment use cases and queue on PGlite; only the paid providers are fakes.

const taberu = 1358280
const kuu = 1269130
const meshiagaru = 1594790

/** Runs jobs until the queue has nothing runnable, returning how many ran. */
const drain = (kinds: ReadonlyArray<Enrichment.JobKind>) =>
  Effect.gen(function* () {
    let ran = 0
    while (yield* Enrichment.claimAndRun(kinds)) ran++
    return ran
  })

const status = (entryId: number) =>
  Effect.map(Enrichment.statusFor(entryId), (map) => [...map].sort(([a], [b]) => a.localeCompare(b)))

const attempts = (entryId: number) =>
  Effect.flatMap(Database, (db) =>
    db.select({ attempts: jobs.attempts }).from(jobs).where(eq(jobs.entryId, entryId))
  ).pipe(Effect.map((rows) => rows[0]?.attempts))

layer(servicesWith())("Enrichment.claimAndRun", (it) => {
  it.effect("runs queued enrichment, voicing examples once they exist", () =>
    Effect.gen(function* () {
      yield* Dictionary.insertEntries([
        entry(taberu, "食べる", "たべる", [sense(["to eat"]), sense(["to live on (e.g. a salary)"])]),
        entry(kuu, "食う", "くう", [sense(["to eat"], { misc: ["male"] })])
      ])
      const kinds = yield* Enrichment.available
      assert.deepStrictEqual(kinds, ["nuance", "examples", "audio"])

      // What the API does when a learner opens an entry.
      yield* Enrichment.enqueue("nuance", taberu, 100)
      yield* Enrichment.enqueue("examples", taberu, 100)
      assert.strictEqual(yield* drain(kinds), 3)

      assert.deepStrictEqual(
        (yield* Enrichment.nuanceFor([taberu])).map((row) => [row.sense, row.model]),
        [
          [0, "jev-test"],
          [1, "jev-test"]
        ]
      )
      // Jev saw the word sharing "to eat" as a candidate for the first sense, and only there.
      const [first, second] = jev.states as Array<{ word: string; candidates?: Array<{ word: string }> }>
      assert.deepStrictEqual(
        first?.candidates?.map((c) => c.word),
        ["食う"]
      )
      assert.isUndefined(second?.candidates)

      const page = Option.getOrThrow(yield* Dictionary.entry(EntryId.make(taberu)))
      assert.deepStrictEqual(
        page.senses[0]?.similar.map((s) => [s.entryId, s.difference]),
        [[kuu, "more_casual"]]
      )
      const [example] = yield* Enrichment.examplesFor([taberu])
      assert.strictEqual(example?.furigana, "パンを{食|た}べる。")
      assert.strictEqual(example?.model, "claude-test")

      // The audio job was queued by the examples job: headword and sentence are both voiced.
      assert.deepStrictEqual(spoken, ["たべる", "パンを食べる。"])
      assert.isTrue((yield* entryClips([taberu])).has(taberu))
      assert.isTrue((yield* exampleClips([example!.id])).has(`${example!.id}:ja`))
      assert.deepStrictEqual(page.enrichment, { nuance: "ready", examples: "ready", audio: "ready" })
      assert.deepStrictEqual(yield* status(taberu), [
        ["audio", "done"],
        ["examples", "done"],
        ["nuance", "done"]
      ])
    })
  )

  it.effect("puts a failed job back with a delay and runs it once that has passed", () =>
    Effect.gen(function* () {
      jev.mode = "down"
      yield* Enrichment.enqueue("nuance", kuu, 10)
      assert.isTrue(yield* Enrichment.claimAndRun(["nuance"]))
      assert.deepStrictEqual(yield* status(kuu), [["nuance", "queued"]])
      assert.isFalse(yield* Enrichment.claimAndRun(["nuance"]))

      jev.mode = "up"
      yield* TestClock.adjust("61 seconds")
      assert.isTrue(yield* Enrichment.claimAndRun(["nuance"]))
      assert.deepStrictEqual(yield* status(kuu), [["nuance", "done"]])
      assert.strictEqual((yield* Enrichment.nuanceFor([kuu])).length, 1)
    })
  )

  it.effect("puts an interrupted job back without counting the attempt", () =>
    Effect.gen(function* () {
      yield* Dictionary.insertEntries([entry(meshiagaru, "召し上がる", "めしあがる", [sense(["to eat"])])])
      jev.mode = "hang"
      yield* Enrichment.enqueue("nuance", meshiagaru, 10)
      const worker = yield* Effect.forkChild(Enrichment.claimAndRun(["nuance"]))
      while ((yield* Enrichment.statusFor(meshiagaru)).get("nuance") !== "running") yield* Effect.yieldNow
      // A deploy stops the worker mid-job.
      yield* Fiber.interrupt(worker)
      assert.deepStrictEqual(yield* status(meshiagaru), [["nuance", "queued"]])
      assert.strictEqual(yield* attempts(meshiagaru), 0)

      jev.mode = "up"
      assert.isTrue(yield* Enrichment.claimAndRun(["nuance"]))
      assert.strictEqual(yield* attempts(meshiagaru), 1)
    })
  )

  it.effect("backfills most frequent words first and reports coverage", () =>
    Effect.gen(function* () {
      yield* Dictionary.insertEntries([entry(1, "鯛焼き", "たいやき", [sense(["taiyaki"])], { common: false })])
      assert.deepStrictEqual(yield* Enrichment.backlog("nuance", { limit: 10, commonOnly: false }), [1])
      assert.deepStrictEqual(yield* Enrichment.backlog("audio", { limit: 10, commonOnly: true }), [kuu, meshiagaru])
      assert.deepStrictEqual(yield* Enrichment.coverage, {
        entries: 4,
        common: 3,
        enriched: { nuance: 3, examples: 1, audio: 1 }
      })
    })
  )
})

const WithBudget = servicesWith().pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ KOTORI_AUDIO_MONTHLY_CHARS: "10" })))
)

layer(WithBudget)("Enrichment.speak", (it) => {
  it.effect("synthesises each clip once and serves it from the database afterwards", () =>
    Effect.gen(function* () {
      spoken.length = 0
      const key = yield* Enrichment.speak("たべる", "ja")
      assert.isTrue(Enrichment.isAudioKey(key))
      assert.strictEqual(yield* Enrichment.speak(" たべる ", "ja"), key)
      assert.deepStrictEqual(spoken, ["たべる"])
      const bytes = Option.getOrThrow(yield* Enrichment.clip(key))
      assert.strictEqual(new TextDecoder().decode(bytes), "mp3:たべる")
    })
  )

  it.effect("refuses to exceed the monthly character budget", () =>
    Effect.gen(function* () {
      const error = yield* Enrichment.speak("これはとても長い文章です", "ja").pipe(Effect.flip)
      assert.strictEqual(error.reason, "quota")
    })
  )
})

layer(servicesWith(undefined, OfflineElevenLabs))("Enrichment without a provider", (it) => {
  it.effect("leaves out the kinds nothing is configured for", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* Enrichment.available, ["nuance", "examples"])
    })
  )
})
