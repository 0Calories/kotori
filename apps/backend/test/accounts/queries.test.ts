import { assert, layer } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import { SqlClient } from "effect/sql"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { deleteUser, ensureUser, updateUser, userById, usersByIds } from "../../src/features/accounts/queries.ts"
import { recordUsage, usageSince } from "../../src/features/coaching/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { learner, U1 } from "../fixtures.ts"

layer(DatabaseMemory)("accounts queries", (it) => {
  it.effect("creates a profile once, updates it, and deletes it with everything the learner did", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const created = yield* ensureUser(db, learner)
      assert.strictEqual(created.status, "approved")
      // A second `ensureUser` keeps the existing row.
      const again = yield* ensureUser(db, { ...learner, status: "pending", displayName: "ignored" })
      assert.strictEqual(again.status, "approved")
      assert.isNull(again.displayName)

      const updated = yield* updateUser(db, U1, { displayName: "Ash", onboardedAt: new Date(5000), dailyNewLimit: 10 })
      assert.strictEqual(Option.getOrThrow(updated).displayName, "Ash")
      assert.deepStrictEqual(Option.getOrThrow(updated).onboardedAt, new Date(5000))
      assert.strictEqual(Option.getOrThrow(updated).dailyNewLimit, 10)
      assert.deepStrictEqual((yield* usersByIds(db, [U1])).length, 1)

      const own = scopedToUser(db, U1)
      yield* recordUsage(own, "naturalness", new Date(1000))
      yield* recordUsage(own, "speak", new Date(1000))
      assert.strictEqual(yield* usageSince(own, new Date(0), ["naturalness", "how-to-say"]), 1)
      assert.strictEqual(yield* usageSince(own, new Date(0), ["speak"]), 1)
      yield* deleteUser(db, U1)
      assert.isTrue(Option.isNone(yield* userById(db, U1)))
      assert.strictEqual(yield* usageSince(own, new Date(0), ["naturalness", "speak"]), 0)
    })
  )

  it.effect("keeps the profile when deleting the account fails partway", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const sql = yield* SqlClient.SqlClient
      yield* ensureUser(db, learner)
      // As `Accounts.delete` does: the profile, then the identity, in one transaction. The
      // identity's delete failing must bring the profile back, or the learner's next request
      // would recreate it as a fresh pending account.
      const deleted = yield* sql
        .withTransaction(Effect.andThen(deleteUser(db, U1), Effect.die(new Error("Managed Auth refused"))))
        .pipe(Effect.exit)
      assert.isTrue(Exit.isFailure(deleted))
      assert.isTrue(Option.isSome(yield* userById(db, U1)))
      yield* deleteUser(db, U1)
    })
  )
})
