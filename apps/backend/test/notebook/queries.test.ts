import { assert, layer } from "@effect/vitest"
import { NoteId, UserId } from "@kotori/contracts"
import { Effect, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { deleteUser, ensureUser } from "../../src/features/accounts/queries.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { allNotes, deleteNote, insertNote, noteByEntry, noteCount } from "../../src/features/notebook/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries, learner, U1 } from "../fixtures.ts"

const U2 = UserId.make("00000000-0000-4000-8000-000000000002")
const N1 = NoteId.make("00000000-0000-4000-8000-00000000000a")
const N2 = NoteId.make("00000000-0000-4000-8000-00000000000b")
const N3 = NoteId.make("00000000-0000-4000-8000-00000000000c")

layer(DatabaseMemory)("notebook queries", (it) => {
  it.effect("inserts idempotently per (user, entry), lists newest first, and scopes deletions to the owner", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, entries.slice(0, 2))
      yield* ensureUser(db, learner)
      yield* ensureUser(db, { ...learner, id: U2 })
      const own = scopedToUser(db, U1)
      const other = scopedToUser(db, U2)
      const firstEntry = entries[0]!.id
      const secondEntry = entries[1]!.id

      const first = yield* insertNote(own, { id: N1, entryId: firstEntry, createdAt: new Date(1000) })
      assert.strictEqual(first.id, N1)

      // Inserting the same (user, entry) again returns the original note.
      const dup = yield* insertNote(own, { id: N2, entryId: firstEntry, createdAt: new Date(2000) })
      assert.strictEqual(dup.id, N1)

      const second = yield* insertNote(own, { id: N3, entryId: secondEntry, createdAt: new Date(3000) })
      assert.strictEqual(second.id, N3)
      assert.deepStrictEqual(
        (yield* allNotes(own)).map((row) => row.id),
        [N3, N1]
      )
      assert.strictEqual(yield* noteCount(own), 2)
      assert.strictEqual(Option.getOrThrow(yield* noteByEntry(own, firstEntry)).id, N1)
      assert.isTrue(Option.isNone(yield* noteByEntry(other, firstEntry)))

      assert.strictEqual(yield* deleteNote(other, N1), "forbidden")
      assert.strictEqual(yield* deleteNote(own, N1), "deleted")
      assert.strictEqual(yield* deleteNote(own, N1), "absent")
      assert.strictEqual(yield* noteCount(own), 1)

      yield* deleteUser(db, U1)
      yield* deleteUser(db, U2)
      assert.strictEqual(yield* noteCount(own), 0)
    })
  )
})
