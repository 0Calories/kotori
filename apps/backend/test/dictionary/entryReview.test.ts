import { assert, layer } from "@effect/vitest"
import type { ProposalStatus } from "@kotori/contracts"
import { entries as entryTable, EntryId, proposals } from "@kotori/db"
import { eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { standing, standingIs } from "../../src/features/asks/queries.ts"
import { reviewEntries } from "../../src/features/dictionary/entryReview.ts"
import { deleteEntries, findForms, insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries, learner, U1 } from "../fixtures.ts"

const [kept, turned, gone] = [EntryId.make(900_001), EntryId.make(900_002), EntryId.make(900_003)]
const draftOf = (id: EntryId, headword: string) => ({
  ...entries[0]!,
  id,
  source: "kotori" as const,
  headword,
  reading: headword,
  forms: [{ ...entries[0]!.forms[0]!, text: headword }],
  review: "unreviewed" as const
})

const reviewsOf = (ids: ReadonlyArray<EntryId>) =>
  Effect.flatMap(Database, (db) =>
    db
      .select({ id: entryTable.id, review: entryTable.review })
      .from(entryTable)
      .where(inArray(entryTable.id, [...ids]))
      .orderBy(entryTable.id)
      .pipe(Effect.orDie)
  )

layer(DatabaseMemory)("an entry's review lifecycle", (it) => {
  it.effect("moves a draft only from where its move starts, and search follows the rules", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [draftOf(kept, "ぴえん"), draftOf(turned, "ぱおん")])

      assert.deepStrictEqual(yield* reviewEntries(db, [kept], "approve"), [kept])
      assert.deepStrictEqual(yield* reviewEntries(db, [turned], "discard"), [turned])
      // Neither move starts from a reviewed entry, so a second review changes nothing.
      assert.deepStrictEqual(yield* reviewEntries(db, [kept], "discard"), [])
      assert.deepStrictEqual(yield* reviewEntries(db, [turned], "approve"), [])
      assert.deepStrictEqual(yield* reviewsOf([kept, turned]), [
        { id: kept, review: "approved" },
        { id: turned, review: "discarded" }
      ])

      // The approved word is in the dictionary; the discarded one isn't even searchable.
      const found = (scope: "inDictionary" | "searchable") =>
        findForms(db, ["ぴえん", "ぱおん"], "ja", scope).pipe(Effect.map((forms) => forms.map((form) => form.entryId)))
      assert.deepStrictEqual(yield* found("inDictionary"), [kept])
      assert.deepStrictEqual(yield* found("searchable"), [kept])
    })
  )

  it.effect("filters proposals in the database by the standing they read as", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* insertEntries(db, [draftOf(gone, "てぇてぇ")])
      const answer = (query: string, status: "drafted" | "linked" | "rejected", entryId: EntryId | null) =>
        db
          .insert(proposals)
          .values({
            language: "ja",
            query,
            status,
            entryId,
            reason: null,
            model: "test",
            requestedBy: U1,
            createdAt: new Date(0)
          })
          .pipe(Effect.orDie)
      yield* answer("approved", "drafted", kept)
      yield* answer("discarded", "drafted", turned)
      yield* answer("pending", "drafted", gone)
      yield* answer("linked", "linked", kept)
      yield* answer("rejected", "rejected", null)

      const listed = (shown: ProposalStatus) =>
        db
          .select({ query: proposals.query, status: proposals.status, review: entryTable.review })
          .from(proposals)
          .leftJoin(entryTable, eq(entryTable.id, proposals.entryId))
          .where(standingIs(shown))
          .pipe(Effect.orDie)
      // Every standing finds the one proposal that reads as it, and nothing else.
      for (const shown of ["pending", "approved", "discarded", "linked", "rejected"] as const) {
        const rows = yield* listed(shown)
        assert.deepStrictEqual(
          rows.map((row) => row.query),
          [shown]
        )
        assert.strictEqual(standing(rows[0]!.status, rows[0]!.review ?? "gone"), shown)
      }

      // A draft whose entry went reads as removed, in the filter as in `standing`.
      yield* deleteEntries(db, [gone])
      assert.deepStrictEqual(
        (yield* listed("removed")).map((row) => row.query),
        ["pending"]
      )
      assert.deepStrictEqual(yield* listed("pending"), [])
    })
  )
})
