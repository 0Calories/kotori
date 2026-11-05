import { assert, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { forms, senses } from "@kotori/db"
import { type SQL, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { nullEmptyLists } from "../../src/db/lists.ts"
import { getEntries, insertEntries } from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries, kanji, sense } from "../fixtures.ts"

// Lists are stored NULL when empty (`textList`), and every reader still gets an array.

const raw = <A>(statement: SQL) =>
  Effect.gen(function* () {
    const db = yield* Database
    const result = yield* db.execute(statement)
    return (result as { readonly rows: ReadonlyArray<A> }).rows
  })

/** How many rows of senses and forms store each kind of list: NULL, empty, or with items. */
const listStorage = raw<{ table: string; nulls: number; empties: number; items: number }>(sql`
  SELECT 'senses' AS table, count(*) FILTER (WHERE ${senses.misc} IS NULL)::int AS nulls,
    count(*) FILTER (WHERE ${senses.misc} = '{}')::int AS empties,
    count(*) FILTER (WHERE cardinality(${senses.misc}) > 0)::int AS items FROM ${senses}
  UNION ALL
  SELECT 'forms', count(*) FILTER (WHERE ${forms.tags} IS NULL)::int, count(*) FILTER (WHERE ${forms.tags} = '{}')::int,
    count(*) FILTER (WHERE cardinality(${forms.tags}) > 0)::int FROM ${forms}
  ORDER BY 1 DESC
`)

layer(DatabaseMemory)("lists", (it) => {
  it.effect("are written NULL when empty and read back as arrays", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [...entries, ...english])
      // Two of the fixtures' senses have misc tags, and only English inflections have form tags.
      assert.deepStrictEqual(yield* listStorage, [
        { table: "senses", nulls: 9, empties: 0, items: 2 },
        { table: "forms", nulls: 12, empties: 0, items: 3 }
      ])
      const [taberu, eat] = yield* getEntries(db, [EntryId.make(1358280), EntryId.make(100000001)])
      assert.deepStrictEqual(taberu?.senses[0]?.misc, [])
      assert.deepStrictEqual(taberu?.forms[0]?.restrictions, [])
      assert.deepStrictEqual(taberu?.forms[0]?.priorities, ["ichi1"])
      assert.deepStrictEqual(
        eat?.forms.map((form) => form.tags),
        [[], ["past"], ["past-participle"]]
      )
    })
  )

  it.effect("rows written before are rewritten from empty to NULL in batches, leaving lists with items", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        {
          ...entries[0]!,
          id: EntryId.make(1000001),
          forms: [kanji("古い")],
          senses: [sense(["old"], { misc: ["arch"] })]
        }
      ])
      // As every row was written before lists were stored NULL when empty.
      yield* raw(sql`UPDATE ${senses} SET ${sql.identifier(senses.misc.name)} = coalesce(${senses.misc}, '{}')`)
      yield* raw(sql`UPDATE ${forms} SET ${sql.identifier(forms.tags.name)} = coalesce(${forms.tags}, '{}')`)
      assert.deepStrictEqual(yield* listStorage, [
        { table: "senses", nulls: 0, empties: 9, items: 3 },
        { table: "forms", nulls: 0, empties: 13, items: 3 }
      ])

      const rewritten = yield* nullEmptyLists(db, { batch: 3, vacuumEvery: 2 })
      assert.deepStrictEqual(rewritten, { senses: 9, forms: 13 })
      assert.deepStrictEqual(yield* listStorage, [
        { table: "senses", nulls: 9, empties: 0, items: 3 },
        { table: "forms", nulls: 13, empties: 0, items: 3 }
      ])
      const [old] = yield* getEntries(db, [EntryId.make(1000001)])
      assert.deepStrictEqual(old?.senses[0]?.misc, ["arch"])
      assert.deepStrictEqual(yield* nullEmptyLists(db, { batch: 3, vacuumEvery: 2 }), { senses: 0, forms: 0 })
    })
  )
})
