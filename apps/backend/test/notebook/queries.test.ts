import { assert, layer } from "@effect/vitest"
import { type EntryId, NoteId, UserId } from "@kotori/contracts"
import { Effect, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { allNotes, deleteNote, insertNote, type NewNote, noteByEntry } from "../../src/features/notebook/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { entries, learner, N1, N2, N3, U1 } from "../fixtures.ts"

const at = (ms: number) => new Date(ms)

const U2 = UserId.make("00000000-0000-4000-8000-000000000002")

const [tabemasu, kuu, third] = entries.map((entry) => entry.id)

const note = (id: NoteId, entryId: EntryId, createdAt = 0): NewNote & { readonly id: NoteId } => ({
  id,
  entryId,
  createdAt: at(createdAt)
})

layer(DatabaseMemory)("notebook queries", (it) => {
  it.effect("stores notes and lists them newest first", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* insertEntries(db, entries)
      const own = scopedToUser(db, U1)

      yield* insertNote(own, note(N1, tabemasu!, 0))
      yield* insertNote(own, note(N2, kuu!, 1))
      yield* insertNote(own, note(N3, third!, 2))

      assert.deepStrictEqual(
        (yield* allNotes(own)).map((n) => n.id),
        [N3, N2, N1]
      )

      assert.strictEqual(yield* deleteNote(own, N2), "deleted")
      assert.isTrue(Option.isNone(yield* noteByEntry(own, kuu!)))
      assert.strictEqual((yield* allNotes(own)).length, 2)
      yield* deleteNote(own, N1)
      yield* deleteNote(own, N3)
    })
  )

  it.effect("keeps each learner to their own notes, and accepts deleting missing notes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* insertEntries(db, entries)
      yield* ensureUser(db, { ...learner, id: U2 })
      const own = scopedToUser(db, U1)
      const other = scopedToUser(db, U2)
      const removedId = NoteId.make("00000000-0000-4000-8000-00000000000d")
      const keptId = NoteId.make("00000000-0000-4000-8000-00000000000e")
      yield* insertNote(own, note(removedId, kuu!))
      yield* insertNote(other, note(keptId, third!))

      assert.strictEqual(yield* deleteNote(other, removedId), "forbidden")
      assert.isTrue(Option.isSome(yield* noteByEntry(own, kuu!)))

      assert.strictEqual(yield* deleteNote(own, removedId), "deleted")
      assert.isTrue(Option.isNone(yield* noteByEntry(own, kuu!)))
      assert.isTrue(Option.isSome(yield* noteByEntry(other, third!)))
      assert.strictEqual(yield* deleteNote(own, removedId), "absent")
      assert.strictEqual(yield* deleteNote(own, NoteId.make("00000000-0000-4000-8000-000000000099")), "absent")
      yield* deleteNote(other, keptId)
    })
  )

  it.effect("keeps one note per learner and entry", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* ensureUser(db, learner)
      yield* insertEntries(db, entries)
      const own = scopedToUser(db, U1)

      const saved = yield* insertNote(own, note(N1, tabemasu!))
      assert.strictEqual(saved.id, N1)
      const again = yield* insertNote(own, note(N2, tabemasu!))
      assert.strictEqual(again.id, N1)
      assert.strictEqual((yield* allNotes(own)).length, 1)
      assert.strictEqual(Option.getOrThrow(yield* noteByEntry(own, tabemasu!)).id, N1)
      assert.isTrue(Option.isNone(yield* noteByEntry(own, kuu!)))

      yield* deleteNote(own, N1)
    })
  )
})
