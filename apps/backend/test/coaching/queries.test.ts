import { assert, layer } from "@effect/vitest"
import { Effect, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { cachedAnswer, reserveUsage, storeAnswer, usageSince } from "../../src/features/coaching/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { learner, U1 } from "../fixtures.ts"

layer(DatabaseMemory)("coaching queries", (it) => {
  it.effect("caches answers by key with a freshness bound", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* storeAnswer(db, "k", { verdict: "natural", score: 90 }, new Date(1000))
      assert.deepStrictEqual(Option.getOrThrow(yield* cachedAnswer(db, "k", new Date(500))), {
        verdict: "natural",
        score: 90
      })
      assert.isTrue(Option.isNone(yield* cachedAnswer(db, "k", new Date(2000))))
      yield* storeAnswer(db, "k", { verdict: "unnatural", score: 20 }, new Date(3000))
      assert.deepStrictEqual(Option.getOrThrow(yield* cachedAnswer(db, "k", new Date(2000))), {
        verdict: "unnatural",
        score: 20
      })
    })
  )

  it.effect("reserves a request only while the learner is under the limit", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)
      const reserve = (now: number) =>
        reserveUsage(own, {
          kind: "naturalness",
          kinds: ["naturalness", "how-to-say"],
          since: new Date(0),
          limit: 2,
          now: new Date(now)
        })
      assert.isTrue(yield* reserve(1000))
      assert.isTrue(yield* reserve(2000))
      assert.isFalse(yield* reserve(3000))
      // A refused request isn't recorded, so it doesn't push the window further out.
      assert.strictEqual(yield* usageSince(own, new Date(0), ["naturalness"]), 2)
      // Audio is counted on its own.
      assert.strictEqual(yield* usageSince(own, new Date(0), ["speak"]), 0)
    })
  )
})
