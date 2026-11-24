import { assert, describe, it, layer } from "@effect/vitest"
import { EntryId, NoteId } from "@kotori/contracts"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { allNotes, insertNote } from "../../src/features/notebook/queries.ts"
import { type LegacyNote, legacyEntryId, recoverNotes } from "../../src/features/notebook/recover.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, learner, U1 } from "../fixtures.ts"

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

const word = (n: number, entryId: number, headword: string, at: number, column: string | null = null): LegacyNote => ({
  id: id(n),
  userId: U1,
  kind: "word",
  entryId: column,
  content: {
    kind: "word",
    entryId,
    senseIndex: 0,
    headword,
    reading: "",
    meaning: "",
    hint: null,
    example: null,
    audioUrl: null
  },
  createdAt: new Date(at)
})

describe("legacyEntryId", () => {
  const mapped = (note: LegacyNote) => legacyEntryId(note)
  it("maps old integer ids to the new string ids", () => {
    assert.deepStrictEqual(mapped(word(1, 1358280, "食べる", 0)), {
      _tag: "entry",
      entryId: EntryId.make("jmdict:1358280")
    })
    assert.deepStrictEqual(mapped(word(1, 100_000_123, "Polish", 0)), {
      _tag: "entry",
      entryId: EntryId.make("en:Polish")
    })
    assert.deepStrictEqual(mapped(word(1, 200_000_001, "新語", 0)), { _tag: "unrecoverable", reason: "approved-entry" })
    assert.deepStrictEqual(mapped(word(1, 0, "x", 0, "jmdict:42")), {
      _tag: "entry",
      entryId: EntryId.make("jmdict:42")
    })
    assert.deepStrictEqual(mapped(word(1, 0, "x", 0, "1358280")), {
      _tag: "entry",
      entryId: EntryId.make("jmdict:1358280")
    })
    assert.deepStrictEqual(
      mapped({ ...word(1, 0, "", 0), kind: "phrase", content: { kind: "phrase", text: "よろしく" } }),
      { _tag: "unrecoverable", reason: "phrase" }
    )
  })
})

layer(DatabaseMemory)("recoverNotes", (it) => {
  it.effect("restores word notes by id and date, once per entry, and only when applied", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [...entries.slice(0, 2), ...english])
      yield* ensureUser(db, learner)
      const own = scopedToUser(db, U1)
      // Saved again since the migration: stays as it is.
      yield* insertNote(own, { id: NoteId.make(id(99)), entryId: entries[1]!.id, createdAt: new Date(5000) })

      const legacy: Array<LegacyNote> = [
        word(1, 1358280, "食べる", 2000),
        word(2, 1358280, "食べる", 1000), // a second sense of the same entry, saved earlier
        word(3, 1269130, "食う", 1000),
        word(4, 100_000_007, "Polish", 3000),
        word(5, 1, "unknown", 3000),
        { ...word(6, 0, "", 0), kind: "phrase", content: { kind: "phrase", text: "よろしく" } },
        { ...word(7, 1358280, "食べる", 0), userId: id(77) }
      ]

      const dry = yield* recoverNotes(db, legacy, { apply: false })
      assert.strictEqual(dry.restored, 2)
      assert.strictEqual((yield* allNotes(own)).length, 1)

      const report = yield* recoverNotes(db, legacy, { apply: true })
      assert.strictEqual(report.restored, 2)
      assert.deepStrictEqual(
        report.skipped.map(({ note, reason }) => [note.id, reason]).sort(([a], [b]) => a!.localeCompare(b!)),
        [
          [id(1), "already-saved"],
          [id(3), "already-saved"],
          [id(5), "missing-entry"],
          [id(6), "phrase"],
          [id(7), "missing-user"]
        ]
      )
      const restored = yield* allNotes(own)
      assert.deepStrictEqual(
        restored.map((row) => [row.id, row.entryId, row.createdAt.getTime()]),
        [
          [id(99), entries[1]!.id, 5000],
          [id(4), EntryId.make("en:Polish"), 3000],
          [id(2), entries[0]!.id, 1000]
        ]
      )

      // Running it again changes nothing.
      assert.strictEqual((yield* recoverNotes(db, legacy, { apply: true })).restored, 0)
    })
  )
})
