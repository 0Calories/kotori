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
          windows: [{ since: new Date(0), limit: 2 }],
          now: new Date(now)
        })
      assert.isTrue(Option.isNone(yield* reserve(1000)))
      assert.isTrue(Option.isNone(yield* reserve(2000)))
      assert.isTrue(Option.isSome(yield* reserve(3000)))
      // A refused request isn't recorded, so it doesn't push the window further out.
      assert.strictEqual(yield* usageSince(own, new Date(0), ["naturalness"]), 2)
      // Audio is counted on its own.
      assert.strictEqual(yield* usageSince(own, new Date(0), ["speak"]), 0)
    })
  )

  it.effect("records one request however many windows it is checked against, and names the full one", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)
      const hour = { since: new Date(10_000), limit: 5 }
      const day = { since: new Date(0), limit: 3 }
      const reserve = (now: number) =>
        reserveUsage(own, { kind: "ask", kinds: ["ask"], windows: [hour, day], now: new Date(now) })
      assert.isTrue(Option.isNone(yield* reserve(10_000)))
      assert.isTrue(Option.isNone(yield* reserve(11_000)))
      assert.strictEqual(yield* usageSince(own, new Date(0), ["ask"]), 2)
      assert.isTrue(Option.isNone(yield* reserve(12_000)))
      assert.strictEqual(Option.getOrThrow(yield* reserve(13_000)), day)
    })
  )
})
