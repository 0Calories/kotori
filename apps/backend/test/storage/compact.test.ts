import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { compactTables } from "../../src/db/compact.ts"
import { Database } from "../../src/db/Database.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries } from "../fixtures.ts"

const MB = 1024 * 1024

layer(DatabaseMemory)("compacting the dictionary's tables", (it) => {
  it.effect("goes smallest first, and only compacts what fits under the cap", () =>
    Effect.gen(function* () {
      const db = yield* Database
      // Repeated upserts leave MVCC dead tuples so compaction measurably shrinks the tables.
      for (let i = 0; i < 3; i++) yield* insertEntries(db, [...entries, ...english])

      const planned = yield* compactTables(db, { cap: 1024 * MB, reserve: 0, dryRun: true })
      assert.deepStrictEqual(
        planned.map((step) => step.compacted),
        [false, false, false, false]
      )
      assert.sameMembers(
        planned.map((step) => step.table),
        ["entries", "senses", "glosses", "forms"]
      )
      const sizes = planned.map((step) => step.before)
      assert.deepStrictEqual(
        sizes,
        [...sizes].sort((a, b) => a - b)
      )

      const full = yield* compactTables(db, { cap: planned[0]!.database, reserve: 0, dryRun: false })
      assert.deepStrictEqual(
        full.map((step) => [step.fits, step.compacted]),
        [[false, false]]
      )

      const done = yield* compactTables(db, { cap: 1024 * MB, reserve: 0, dryRun: false })
      assert.isTrue(done.every((step) => step.compacted && step.after <= step.before))
      assert.isBelow(
        done.reduce((sum, step) => sum + step.after, 0),
        done.reduce((sum, step) => sum + step.before, 0)
      )
    })
  )
})
