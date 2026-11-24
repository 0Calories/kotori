import { assert, describe, expect, it, layer } from "@effect/vitest"
import { EntryId, NoteId } from "@kotori/contracts"
import { PgliteClient } from "@effect/sql-pglite"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Effect, Layer, Option } from "effect"
import { Database } from "../../src/db/Database.ts"
import { relations } from "../../src/db/relations.ts"
import { scopedToUser } from "../../src/db/scopedToUser.ts"
import { ensureUser } from "../../src/features/accounts/queries.ts"
import {
  NotedEntriesWouldBeDeleted,
  removeStale,
  successorsOf
} from "../../src/features/dictionary/import/english/staleEntries.ts"
import { insertEntries } from "../../src/features/dictionary/queries.ts"
import { allNotes, insertNote } from "../../src/features/notebook/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { learner, U1 } from "../fixtures.ts"

/** Every statement Drizzle sends, in order. */
const statements: Array<string> = []

/** The test database, with Drizzle logging each statement into `statements`. */
const LoggedDatabase = Layer.effect(
  Database,
  PgliteDrizzle.make({ relations }).pipe(
    Effect.provide(
      Layer.succeed(PgliteDrizzle.EffectLogger, {
        logQuery: (query) => Effect.sync(() => void statements.push(query))
      })
    ),
    Effect.provide(PgliteDrizzle.DefaultServices)
  )
).pipe(
  Layer.provide(Layer.effect(PgliteClient.PgliteClient, PgliteClient.PgliteClient).pipe(Layer.provide(DatabaseMemory)))
)

const word = (headword: string) => ({
  id: EntryId.make(`en:${headword}`),
  language: "en" as const,
  source: "jawiktionary" as const,
  headword,
  reading: "",
  common: false,
  priority: 0,
  forms: [],
  senses: []
})

describe("successorsOf", () => {
  const form = (kind: "spelling" | "inflection", text: string) => ({
    kind,
    text,
    common: false,
    tags: [],
    priorities: [],
    restrictions: [],
    noKanji: false
  })
  const entry = (headword: string, forms: ReadonlyArray<ReturnType<typeof form>>) => ({
    ...word(headword),
    forms: [form("spelling", headword), ...forms]
  })

  it("follows any form of exactly one entry, then a headword or form differing only by case", () => {
    const successors = successorsOf(
      [
        entry("sin", [form("inflection", "sins")]),
        entry("spartan", [form("spelling", "Spartan")]),
        entry("iPod", []),
        // A form two entries share names neither.
        entry("lead", [form("inflection", "leads")]),
        entry("Lead", [form("inflection", "leads")]),
        entry("EV", []),
        entry("eV", []),
        // A form written in another case: "abcs" is now the plural of "ABC", "ABCs".
        entry("ABC", [form("inflection", "ABCs")])
      ],
      ["sins", "Spartan", "ipod", "leads", "ev", "abcs", "gone"].map((headword) => EntryId.make(`en:${headword}`))
    )
    expect(Object.fromEntries(successors)).toEqual({
      "en:sins": "en:sin",
      "en:Spartan": "en:spartan",
      "en:ipod": "en:iPod",
      "en:abcs": "en:ABC"
    })
  })
})

layer(LoggedDatabase)("removeStale", (it) => {
  it.effect("locks the stale words and their successors before moving notes, counting and deleting", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [word("Spartan"), word("spartan"), word("walk")])
      yield* ensureUser(db, learner)
      yield* insertNote(scopedToUser(db, U1), {
        id: NoteId.make("00000000-0000-4000-8000-0000000000e1"),
        entryId: EntryId.make("en:Spartan")
      })

      statements.length = 0
      yield* removeStale(
        db,
        [EntryId.make("en:Spartan"), EntryId.make("en:walk")],
        new Map([[EntryId.make("en:Spartan"), EntryId.make("en:spartan")]])
      )

      const first = (pattern: RegExp) => statements.findIndex((statement) => pattern.test(statement))
      const lock = first(/from "entries".* for update/is)
      assert.isAtLeast(lock, 0, statements.join("\n---\n"))
      assert.isBelow(lock, first(/^update "notes"/i))
      assert.isBelow(lock, first(/count\(\*\).*from "notes"/is))
      assert.isBelow(lock, first(/^delete from "entries"/i))
      assert.deepStrictEqual(
        (yield* allNotes(scopedToUser(db, U1))).map((note) => note.entryId),
        [EntryId.make("en:spartan")]
      )
    })
  )

  it.effect("refuses a deletion a note was saved in the way of, saying the import's words were written", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [word("run")])
      yield* insertNote(scopedToUser(db, U1), {
        id: NoteId.make("00000000-0000-4000-8000-0000000000e2"),
        entryId: EntryId.make("en:run")
      })
      const error = yield* Effect.flip(removeStale(db, [EntryId.make("en:run")], new Map()))
      assert.instanceOf(error, NotedEntriesWouldBeDeleted)
      assert.strictEqual(error.stage, "after-writing")
      assert.include(error.message, "en:run (1 note)")
      assert.include(error.message, "The import's words were written; the words it no longer has were kept")
      assert.isTrue(Option.isSome(Option.fromNullishOr((yield* allNotes(scopedToUser(db, U1)))[0])))
    })
  )
})
