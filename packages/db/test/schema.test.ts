import { assert, describe, it, layer } from "@effect/vitest"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../src/Database.ts"
import { entries, forms, glosses, senses } from "../src/schema/index.ts"
import { DatabaseMemory } from "../src/testing.ts"

// The schema's Postgres-level behaviour, on PGlite: the parts a query can't
// express and so a service can't test on its own. Generated full-text column, bytewise
// collation for the prefix scan, cascades, and relational reads.

// The layer is shared by the tests in this file, so each starts from an empty dictionary.
const seed = Effect.gen(function* () {
  const db = yield* Database
  yield* db.execute(sql`TRUNCATE ${entries} CASCADE`)
  yield* db.insert(entries).values([
    { id: 1, headword: "食べる", reading: "たべる", common: true, priority: 90 },
    { id: 2, headword: "食う", reading: "くう", common: false, priority: 10 }
  ])
  yield* db.insert(forms).values([
    { entryId: 1, kind: "kanji", position: 0, text: "食べる", common: true, priorities: ["ichi1"] },
    { entryId: 1, kind: "kana", position: 0, text: "たべる", common: true },
    { entryId: 2, kind: "kanji", position: 0, text: "食う" },
    { entryId: 2, kind: "kana", position: 0, text: "くう" }
  ])
  yield* db.insert(senses).values([
    { entryId: 1, position: 0, pos: ["v1", "vt"] },
    { entryId: 2, position: 0, pos: ["v5u", "vt"], misc: ["male"] }
  ])
  yield* db.insert(glosses).values([
    { entryId: 1, sense: 0, position: 0, text: "to eat", norm: "eat" },
    { entryId: 1, sense: 0, position: 1, text: "to live on (e.g. a salary)", norm: "live on" },
    { entryId: 2, sense: 0, position: 0, text: "to eat", norm: "eat" }
  ])
})

layer(DatabaseMemory)("schema", (it) => {
  it.effect("indexes glosses for English full-text search as they are inserted", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      const query = sql`plainto_tsquery('english', 'eating')`
      const hits = yield* db
        .select({ entryId: glosses.entryId, rank: sql<number>`ts_rank(${glosses.document}, ${query})` })
        .from(glosses)
        .where(sql`${glosses.document} @@ ${query}`)
        .orderBy(glosses.entryId)
      assert.deepStrictEqual(
        hits.map((hit) => hit.entryId),
        [1, 2]
      )
      assert.isAbove(hits[0]!.rank, 0)
    })
  )

  it.effect("compares form text bytewise, so the prefix range scan is exact", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      const prefix = "食"
      const rows = yield* db
        .selectDistinct({ entryId: forms.entryId })
        .from(forms)
        .where(sql`${forms.text} >= ${prefix} AND ${forms.text} < ${prefix + "\u{10FFFF}"}`)
        .orderBy(forms.entryId)
      assert.deepStrictEqual(
        rows.map((row) => row.entryId),
        [1, 2]
      )
      const collation = yield* db.execute(
        sql`SELECT collation_name FROM information_schema.columns WHERE table_name = 'forms' AND column_name = 'text'`
      )
      assert.deepStrictEqual((collation as { rows: ReadonlyArray<unknown> }).rows, [{ collation_name: "C" }])
    })
  )

  it.effect("reads an entry with its forms, senses and glosses in one relational query", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      const entry = yield* db.query.entries.findFirst({
        where: { id: 1 },
        with: {
          forms: { orderBy: { kind: "asc", position: "asc" } },
          senses: { with: { glosses: { orderBy: { position: "asc" } } } }
        }
      })
      assert.strictEqual(entry?.headword, "食べる")
      assert.deepStrictEqual(
        entry?.forms.map((form) => form.text),
        ["食べる", "たべる"]
      )
      assert.deepStrictEqual(
        entry?.senses[0]?.glosses.map((gloss) => gloss.text),
        ["to eat", "to live on (e.g. a salary)"]
      )
      assert.deepStrictEqual(entry?.senses[0]?.pos, ["v1", "vt"])
    })
  )

  it.effect("deleting an entry takes its children with it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      yield* db.delete(entries).where(eq(entries.id, 1))
      const left = yield* db.$count(glosses)
      assert.strictEqual(left, 1)
      assert.strictEqual(yield* db.$count(forms), 2)
    })
  )
})

describe("schema", () => {
  it("keeps the dictionary ids JMDict's own", () => {
    assert.strictEqual(entries.id.columnType, "PgInteger")
  })
})
