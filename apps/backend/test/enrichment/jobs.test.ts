import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { Effect, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import {
  claimJob,
  completeJob,
  enqueueJob,
  failJob,
  jobStatusFor,
  refillJob,
  releaseJob
} from "../../src/features/enrichment/jobs.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

const at = (ms: number) => new Date(ms)

/** Jobs reference dictionary entries, so the queue tests need a few to point at. */
const stubEntries = (ids: ReadonlyArray<number>) =>
  Effect.flatMap(Database, (db) =>
    insertEntries(
      db,
      ids.map((id) => ({
        id: EntryId.make(id),
        language: "ja" as const,
        headword: `w${id}`,
        reading: `r${id}`,
        common: false,
        priority: 0,
        forms: [],
        senses: []
      }))
    )
  )

layer(DatabaseMemory)("the job queue", (it) => {
  it.effect("claims the most urgent job once and retries failures", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* stubEntries([1, 2, 3])
      yield* enqueueJob(db, "examples", EntryId.make(1), 0, at(1000), null)
      yield* enqueueJob(db, "examples", EntryId.make(2), 10, at(1000), null)
      yield* enqueueJob(db, "audio", EntryId.make(3), 99, at(1000), null)

      const first = yield* claimJob(db, ["examples"], at(2000))
      assert.strictEqual(Option.getOrThrow(first).entryId, 2)

      yield* failJob(db, Option.getOrThrow(first).id, "boom", at(5000), at(2000))
      const second = yield* claimJob(db, ["examples"], at(3000))
      assert.strictEqual(Option.getOrThrow(second).entryId, 1)

      // The failed job becomes runnable again once its retry time passes.
      assert.isTrue(Option.isNone(yield* claimJob(db, ["examples"], at(4000))))
      const retried = yield* claimJob(db, ["examples"], at(6000))
      assert.strictEqual(Option.getOrThrow(retried).attempts, 2)

      yield* completeJob(db, Option.getOrThrow(retried).id, at(7000))
      const status = yield* jobStatusFor(db, EntryId.make(2))
      assert.strictEqual(status.get("examples"), "done")
    })
  )

  it.effect("puts a job back without counting the attempt when its worker stops", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* stubEntries([10])
      yield* enqueueJob(db, "nuance", EntryId.make(10), 0, at(1000), null)
      const claimed = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(2000)))
      assert.strictEqual(claimed.attempts, 1)

      yield* releaseJob(db, claimed.id, at(2500))
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(10))).get("nuance"), "queued")
      const again = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(3000)))
      assert.strictEqual(again.id, claimed.id)
      assert.strictEqual(again.attempts, 1)
    })
  )

  it.effect("revives a failed job right away when re-enqueued, and after its cool-off when refilled", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* stubEntries([20])
      const id = EntryId.make(20)
      yield* enqueueJob(db, "nuance", id, 0, at(1000), null)

      for (const tick of [1000, 2000, 3000]) {
        const claimed = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(tick)))
        yield* failJob(db, claimed.id, "quota", at(tick + 500), at(tick))
      }
      assert.strictEqual((yield* jobStatusFor(db, id)).get("nuance"), "failed")

      // A soon refill leaves the failed job alone; once the cool-off passes, it queues again.
      yield* refillJob(db, "nuance", id, at(2500), 0, at(4000), null)
      assert.strictEqual((yield* jobStatusFor(db, id)).get("nuance"), "failed")
      yield* refillJob(db, "nuance", id, at(3500), 0, at(4000), null)
      assert.strictEqual((yield* jobStatusFor(db, id)).get("nuance"), "queued")

      // Failing all three attempts again leaves a future retry timestamp, which enqueueJob clears.
      for (const tick of [4000, 5000, 6000]) {
        const claimed = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(tick)))
        yield* failJob(db, claimed.id, "quota", at(tick === 6000 ? 240_000 : tick + 500), at(tick))
      }
      assert.strictEqual((yield* jobStatusFor(db, id)).get("nuance"), "failed")
      yield* enqueueJob(db, "nuance", id, 0, at(7000), null)
      const revived = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(7000)))
      assert.strictEqual(revived.attempts, 1)
    })
  )
})
