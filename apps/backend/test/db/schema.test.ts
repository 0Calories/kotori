import { assert, describe, it, layer } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import {
  englishDocument,
  entries,
  forms,
  glosses,
  labels,
  loanLinks,
  pitfalls,
  senses,
  usageEvidence
} from "@kotori/db"
import { eq, sql } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { Database } from "../../src/db/Database.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

// The schema's Postgres-level behaviour, on PGlite: the parts a query can't
// express and so can't test on its own. Full-text documents, bytewise
// collation for the prefix scan, cascades, and relational reads.

// The layer is shared by the tests in this file, so each starts from an empty dictionary.
const seed = Effect.gen(function* () {
  const db = yield* Database
  yield* db.execute(sql`TRUNCATE ${entries} CASCADE`)
  yield* db.insert(entries).values([
    { id: EntryId.make(1), dictionary: "jmdict", headword: "食べる", reading: "たべる", common: true, priority: 90 },
    { id: EntryId.make(2), dictionary: "jmdict", headword: "食う", reading: "くう", common: false, priority: 10 }
  ])
  yield* db.insert(forms).values([
    { entryId: EntryId.make(1), kind: "kanji", position: 0, text: "食べる", common: true, priorities: ["ichi1"] },
    { entryId: EntryId.make(1), kind: "kana", position: 0, text: "たべる", common: true },
    { entryId: EntryId.make(2), kind: "kanji", position: 0, text: "食う" },
    { entryId: EntryId.make(2), kind: "kana", position: 0, text: "くう" }
  ])
  yield* db.insert(senses).values([
    { entryId: EntryId.make(1), position: 0, pos: ["v1", "vt"] },
    { entryId: EntryId.make(2), position: 0, pos: ["v5u", "vt"], misc: ["male"] }
  ])
  yield* db.insert(glosses).values([
    { entryId: EntryId.make(1), sense: 0, position: 0, text: "to eat", norm: "eat" },
    { entryId: EntryId.make(1), sense: 0, position: 1, text: "to live on (e.g. a salary)", norm: "live on" },
    { entryId: EntryId.make(2), sense: 0, position: 0, text: "to eat", norm: "eat" }
  ])
})

layer(DatabaseMemory)("schema", (it) => {
  it.effect("matches glosses by stemmed English words", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      const query = sql`plainto_tsquery('english', 'eating')`
      const document = englishDocument(glosses.text)
      const hits = yield* db
        .select({ entryId: glosses.entryId, rank: sql<number>`ts_rank(${document}, ${query})` })
        .from(glosses)
        .where(sql`${document} @@ ${query}`)
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
        where: { id: EntryId.make(1) },
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
      yield* db.delete(entries).where(eq(entries.id, EntryId.make(1)))
      const left = yield* db.$count(glosses)
      assert.strictEqual(left, 1)
      assert.strictEqual(yield* db.$count(forms), 2)
    })
  )
})

// Labels, pitfalls, evidence and loan links: the constraints that keep the enrichment model honest.
layer(DatabaseMemory)("enrichment schema", (it) => {
  const pitfall = (rank: number, sense: number | null = null) => ({
    entryId: EntryId.make(2),
    sense,
    rank,
    kind: "rude_upward" as const,
    text: "Rough; say 食べる to anyone above you.",
    aboutEntryId: EntryId.make(1),
    source: "kotori" as const
  })

  it.effect("caps a word's pitfalls at three, one per rank", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      yield* db.insert(pitfalls).values([pitfall(1), pitfall(2, 0), pitfall(3)])
      assert.isTrue(Exit.isFailure(yield* db.insert(pitfalls).values(pitfall(4)).pipe(Effect.exit)))
      assert.isTrue(Exit.isFailure(yield* db.insert(pitfalls).values(pitfall(2)).pipe(Effect.exit)))
      assert.isTrue(Exit.isFailure(yield* db.insert(pitfalls).values(pitfall(0)).pipe(Effect.exit)))
    })
  )

  it.effect("ties a sense-scoped pitfall to a sense that exists", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      assert.isTrue(Exit.isFailure(yield* db.insert(pitfalls).values(pitfall(1, 5)).pipe(Effect.exit)))
    })
  )

  it.effect("reads labels, pitfalls and evidence with the entry, and cascades or unlinks on delete", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* seed
      yield* db.insert(labels).values({ entryId: EntryId.make(2), sense: 0, code: "male", source: "jmdict" })
      yield* db.insert(pitfalls).values(pitfall(1))
      yield* db.insert(usageEvidence).values({ entryId: EntryId.make(1), everyday: true })
      yield* db.insert(loanLinks).values({
        katakana: "クウ",
        katakanaEntryId: EntryId.make(2),
        english: "coo",
        meaning: "same",
        source: "jmdict",
        meaningSource: "kotori"
      })

      const entry = yield* db.query.entries.findFirst({
        where: { id: EntryId.make(2) },
        with: { senses: { with: { labels: true } }, pitfalls: { with: { about: true } }, loansFrom: true }
      })
      assert.deepStrictEqual(
        entry?.senses[0]?.labels.map((label) => label.code),
        ["male"]
      )
      assert.strictEqual(entry?.pitfalls[0]?.about?.headword, "食べる")
      assert.strictEqual(entry?.loansFrom[0]?.english, "coo")

      // The word a pitfall compares with going away leaves the pitfall standing.
      yield* db.delete(entries).where(eq(entries.id, EntryId.make(1)))
      assert.strictEqual(yield* db.$count(pitfalls), 1)
      assert.strictEqual(yield* db.$count(usageEvidence), 0)

      // The word itself going away takes its labels and pitfalls, and leaves the loan link's text.
      yield* db.delete(entries).where(eq(entries.id, EntryId.make(2)))
      assert.strictEqual(yield* db.$count(labels), 0)
      assert.strictEqual(yield* db.$count(pitfalls), 0)
      const [link] = yield* db.select().from(loanLinks)
      assert.strictEqual(link?.katakanaEntryId, null)
    })
  )
})

describe("schema", () => {
  it("keeps the dictionary ids JMDict's own", () => {
    assert.strictEqual(entries.id.columnType, "PgInteger")
  })
})
