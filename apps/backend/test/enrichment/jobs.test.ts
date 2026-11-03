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
      yield* enqueueJob(db, "examples", EntryId.make(1), 0, at(1000))
      yield* enqueueJob(db, "examples", EntryId.make(2), 10, at(1000))
      yield* enqueueJob(db, "audio", EntryId.make(3), 99, at(1000))

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
      yield* enqueueJob(db, "nuance", EntryId.make(10), 0, at(1000))
      const claimed = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(2000)))
      assert.strictEqual(claimed.attempts, 1)

      yield* releaseJob(db, claimed.id, at(2500))
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(10))).get("nuance"), "queued")
      const again = Option.getOrThrow(yield* claimJob(db, ["nuance"], at(3000)))
      assert.strictEqual(again.id, claimed.id)
      assert.strictEqual(again.attempts, 1)
    })
  )
})
