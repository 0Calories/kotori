import { assert, describe, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import {
  contentTokens,
  DatabaseMemory,
  DictionaryRepo,
  type EntryRecord,
  fuzzyHits,
  fuse,
  isSingleLatinWord,
  rankByCosine,
  rankOverlap,
  Repositories,
  shouldFallback,
  SituationRepo
} from "../src/index.ts"

const vector = (index: number) => {
  const values = new Float32Array(384)
  values[index] = 1
  return values
}

const entry = (id: number, headword: string, reading: string): EntryRecord => ({
  id,
  headword,
  reading,
  common: true,
  priority: 10,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [{
    glosses: [{ text: "to eat", type: null }],
    pos: ["v1"],
    misc: [],
    fields: [],
    dialects: [],
    info: [],
    stagk: [],
    stagr: [],
    xrefs: [],
    antonyms: []
  }]
})

const TestLayer = Repositories.pipe(Layer.provideMerge(DatabaseMemory))

describe("fuse", () => {
  layer(Layer.empty)((it) => {
    it.effect("prefers a hit that both lists rank first", () =>
      Effect.sync(() => {
        const fused = fuse(
          ["intro", "hungry"],
          [{ id: "intro", cosine: 0.9 }, { id: "other", cosine: 0.8 }]
        )
        assert.strictEqual(fused[0]?.id, "intro")
        assert.isAbove(fused[0]?.score ?? 0, fused[1]?.score ?? 0)
        const onlyVector = fuse([], [{ id: "other", cosine: 0.84 }])
        assert.isBelow(onlyVector[0]?.score ?? 1, 0.5)
        const ranked = rankByCosine(vector(1), [
          { id: "a", vector: vector(0) },
          { id: "b", vector: vector(1) }
        ], 2)
        assert.strictEqual(ranked[0]?.id, "b")

        assert.deepStrictEqual(contentTokens("how do I introduce myself"), ["introduce", "myself"])
        assert.deepStrictEqual(contentTokens("thankyou very much"), ["thank", "much"])
        assert.isTrue(isSingleLatinWord("station"))
        assert.isFalse(isSingleLatinWord("where is the station"))
        assert.isFalse(isSingleLatinWord("自己紹介"))
        assert.isTrue(shouldFallback("eat", 0.9))
        assert.isFalse(shouldFallback("where is the station", 0.9))

        const overlap = rankOverlap(["name", "meet", "polite"], [
          { token: "name", id: "intro", field: "my name", rank: 0 },
          { token: "meet", id: "intro", field: "nice to meet you", rank: 1 },
          { token: "name", id: "other", field: "your name", rank: 2 }
        ], 5)
        assert.deepStrictEqual(overlap, ["intro"])
        const crowd = [
          { token: "break", id: "luck", field: "break a leg", rank: 0 },
          ...Array.from({ length: 15 }, (_, index) => ({
            token: "someone",
            id: `s${index}`,
            field: "someone",
            rank: index
          }))
        ]
        assert.deepStrictEqual(rankOverlap(["break", "someone"], crowd, 5), [])
        const shared = rankOverlap(["price", "haircut"], [
          { token: "price", id: "shop", field: "what's the price", rank: 0 },
          { token: "price", id: "other", field: "price", rank: 1 }
        ], 5)
        assert.deepStrictEqual(shared, [])
        const ambiguous = rankOverlap(["break"], [
          { token: "break", id: "phone", field: "you're breaking up", rank: 0 },
          { token: "break", id: "luck", field: "break a leg", rank: 1 }
        ], 5)
        assert.deepStrictEqual(ambiguous, [])
        assert.deepStrictEqual(fuzzyHits("introduse", [
          { id: "intro", tokens: ["introduce", "myself"] },
          { id: "other", tokens: ["morning"] }
        ]), ["intro"])
      }))
  })
})

layer(TestLayer)("SituationRepo", (it) => {
  it.effect("searches keywords, Japanese, and vectors, and logs a miss", () =>
    Effect.gen(function*() {
      const dictionary = yield* DictionaryRepo
      const repo = yield* SituationRepo
      yield* dictionary.insertEntries([entry(1, "食べる", "たべる")])
      const eat = vector(0)
      const other = vector(1)
      yield* repo.replaceAll([
        {
          id: "intro",
          title: "Introducing yourself",
          category: "introductions",
          note: "Start with your name.",
          aliases: ["how do I introduce myself", "自己紹介"],
          phrases: [{
            ja: "はじめまして。",
            reading: "はじめまして。",
            en: "Nice to meet you.",
            formality: "polite"
          }],
          entryIds: [1],
          embeddings: [
            { text: "how do I introduce myself", vector: other },
            { text: "自己紹介", vector: other }
          ]
        },
        {
          id: "hungry",
          title: "Saying you're hungry",
          category: "feelings",
          note: "お腹が空いた is casual.",
          aliases: ["I'm hungry", "I want to eat"],
          phrases: [{ ja: "お腹が空いた。", reading: "おなかがすいた。", en: "I'm hungry.", formality: "casual" }],
          entryIds: [1],
          embeddings: [{ text: "I want to eat", vector: eat }]
        }
      ])

      assert.strictEqual(yield* repo.count, 2)
      assert.strictEqual(yield* repo.vectorBackend, "sqlite-vec")
      assert.deepStrictEqual(yield* repo.searchKeyword(`"introduce" "myself"`, 5), ["intro"])
      assert.strictEqual((yield* repo.searchJapanese("自己紹介", 5))[0], "intro")
      const hits = yield* repo.searchVector(eat, 2)
      assert.strictEqual(hits[0]?.id, "hungry")
      assert.isAbove(hits[0]?.cosine ?? 0, 0.99)

      const [loaded] = yield* repo.getMany(["intro"])
      assert.deepStrictEqual(loaded?.entryIds, [1])
      assert.deepStrictEqual(loaded?.aliases, ["how do I introduce myself", "自己紹介"])

      yield* repo.logMiss("how do I break up", 0.2, "intro")
      const sql = yield* SqlClient.SqlClient
      const misses = yield* sql`SELECT query FROM situation_misses`
      assert.strictEqual((misses[0] as { query: string }).query, "how do I break up")
    }))
})
