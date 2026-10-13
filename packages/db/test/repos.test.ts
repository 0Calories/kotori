import { assert, describe, layer } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import {
  DatabaseMemory,
  DictionaryRepo,
  type EntryRecord,
  JobsRepo,
  normalizeGloss,
  Repositories,
  StudyRepo,
  UsersRepo
} from "../src/index.ts"

const sense = (glosses: Array<string>, extra: Partial<EntryRecord["senses"][number]> = {}) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1", "vt"],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  ...extra
})

const kanji = (text: string, common = true) => ({
  kind: "kanji" as const,
  text,
  common,
  tags: [],
  priorities: common ? ["ichi1"] : [],
  restrictions: [],
  noKanji: false
})
const kana = (text: string, common = true) => ({ ...kanji(text, common), kind: "kana" as const })

const entries: Array<EntryRecord> = [
  {
    id: 1358280,
    headword: "食べる",
    reading: "たべる",
    common: true,
    priority: 120,
    forms: [kanji("食べる"), kana("たべる")],
    senses: [sense(["to eat"]), sense(["to live on (e.g. a salary)", "to subsist on"])]
  },
  {
    id: 1269130,
    headword: "食う",
    reading: "くう",
    common: true,
    priority: 80,
    forms: [kanji("食う"), kana("くう")],
    senses: [sense(["to eat"], { misc: ["male"] }), sense(["to bite"])]
  },
  {
    id: 1594790,
    headword: "召し上がる",
    reading: "めしあがる",
    common: true,
    priority: 60,
    forms: [kanji("召し上がる"), kana("めしあがる")],
    senses: [sense(["to eat", "to drink"], { misc: ["hon"] })]
  },
  {
    id: 1000000,
    headword: "鯛焼き",
    reading: "たいやき",
    common: false,
    priority: 0,
    forms: [kanji("鯛焼き", false), kana("たいやき", false)],
    senses: [sense(["taiyaki", "fish-shaped pancake filled with bean jam"], { pos: ["n"] })]
  }
]

const TestLayer = Repositories.pipe(Layer.provideMerge(DatabaseMemory))

describe("normalizeGloss", () => {
  layer(Layer.empty)((it) => {
    it.effect("strips infinitive markers, articles and parentheticals", () =>
      Effect.sync(() => {
        assert.strictEqual(normalizeGloss("to eat (a meal)"), "eat")
        assert.strictEqual(normalizeGloss("The Sun"), "sun")
        assert.strictEqual(normalizeGloss("(of a person) to be late"), "be late")
      }))
  })
})

layer(TestLayer)("DictionaryRepo", (it) => {
  it.effect("imports entries and reads them back in order", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries(entries)
      yield* repo.rebuildSearchIndex
      assert.strictEqual(yield* repo.count, 4)

      const [taberu] = yield* repo.getEntries([1358280])
      assert.strictEqual(taberu?.headword, "食べる")
      assert.deepStrictEqual(taberu?.forms.map((form) => form.text), ["食べる", "たべる"])
      assert.strictEqual(taberu?.senses[1]?.glosses[0]?.text, "to live on (e.g. a salary)")
    }))

  it.effect("re-importing an entry replaces it", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries([{ ...entries[3]!, priority: 5 }])
      yield* repo.rebuildSearchIndex
      const [taiyaki] = yield* repo.getEntries([1000000])
      assert.strictEqual(taiyaki?.priority, 5)
      assert.strictEqual(taiyaki?.forms.length, 2)
    }))

  it.effect("finds Japanese forms exactly and by prefix", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      const exact = yield* repo.findForms(["たべる"])
      assert.deepStrictEqual(exact.map((match) => match.entryId), [1358280])
      assert.deepStrictEqual(yield* repo.findFormPrefix("た", 10), [1358280, 1000000])
    }))

  it.effect("searches English glosses with stemming and exact matching", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      const fts = yield* repo.searchGlosses(`"eating"`, 20)
      assert.includeMembers(fts.map((match) => match.entryId), [1358280, 1269130, 1594790])

      const exact = yield* repo.findGlossesExact("Eat", 20)
      assert.deepStrictEqual(exact.map((match) => match.entryId), [1358280, 1269130, 1594790])
    }))

  it.effect("suggests words sharing a meaning as similar-word candidates", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      const candidates = yield* repo.sharedGlossCandidates(1358280, 0, 10)
      assert.deepStrictEqual(candidates.map((c) => c.entryId), [1269130, 1594790])
      assert.deepStrictEqual(yield* repo.sharedGlossCandidates(1358280, 1, 10), [])
    }))

  it.effect("lists entries missing enrichment in priority order", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      assert.deepStrictEqual(yield* repo.entriesByPriority({ limit: 2, missing: "nuance" }), [1358280, 1269130])
      assert.deepStrictEqual(yield* repo.entriesByPriority({ limit: 10, commonOnly: true }), [
        1358280,
        1269130,
        1594790
      ])
    }))
})

layer(TestLayer)("JobsRepo", (it) => {
  it.effect("claims the most urgent job once and retries failures", () =>
    Effect.gen(function*() {
      const jobs = yield* JobsRepo
      yield* jobs.enqueue("examples", 1, 0, 1000)
      yield* jobs.enqueue("examples", 2, 10, 1000)
      yield* jobs.enqueue("audio", 3, 99, 1000)

      const first = yield* jobs.claim(["examples"], 2000)
      assert.strictEqual(Option.getOrThrow(first).entryId, 2)

      yield* jobs.fail(Option.getOrThrow(first).id, "boom", 5000, 2000)
      const second = yield* jobs.claim(["examples"], 3000)
      assert.strictEqual(Option.getOrThrow(second).entryId, 1)

      // The failed job becomes runnable again once its retry time passes.
      assert.isTrue(Option.isNone(yield* jobs.claim(["examples"], 4000)))
      const retried = yield* jobs.claim(["examples"], 6000)
      assert.strictEqual(Option.getOrThrow(retried).attempts, 2)

      yield* jobs.complete(Option.getOrThrow(retried).id, 7000)
      const status = yield* jobs.statusFor(2)
      assert.strictEqual(status.get("examples"), "done")
    }))
})

layer(TestLayer)("StudyRepo", (it) => {
  it.effect("stores notes with cards and serves due queues", () =>
    Effect.gen(function*() {
      const users = yield* UsersRepo
      const study = yield* StudyRepo
      yield* users.create({
        id: "u1",
        tokenHash: "hash",
        nativeLanguage: "en",
        targetLanguage: "ja",
        displayName: null,
        timezone: "Asia/Tokyo",
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        createdAt: 0
      })

      const card = (id: string, queue: "new" | "review", due: number) => ({
        id,
        noteId: "n1",
        userId: "u1",
        template: "recognize" as const,
        queue,
        due,
        interval: queue === "review" ? 3 : 0,
        ease: queue === "review" ? 2.5 : 0,
        step: 0,
        reps: 0,
        lapses: 0,
        leech: false,
        lastReview: null,
        seed: 7,
        position: 0,
        createdAt: 0
      })

      yield* study.insertNote(
        {
          id: "n1",
          userId: "u1",
          content: {
            kind: "phrase",
            text: "お疲れ様です",
            furigana: "お{疲|つか}れ{様|さま}です",
            meaning: "Thanks for your hard work",
            note: null,
            register: "polite",
            source: "manual"
          },
          entryId: null,
          sense: null,
          createdAt: 0
        },
        [card("c1", "new", 0), { ...card("c2", "review", 500), template: "produce" }]
      )

      const notes = yield* study.notes("u1")
      assert.strictEqual(notes.length, 1)
      assert.strictEqual(notes[0]?.cards.length, 2)

      assert.deepStrictEqual((yield* study.newCards("u1", 10)).map((c) => c.id), ["c1"])
      assert.deepStrictEqual((yield* study.reviewDue("u1", 1000, 10)).map((c) => c.id), ["c2"])
      assert.deepStrictEqual(yield* study.reviewDue("u1", 100, 10), [])

      const loaded = Option.getOrThrow(yield* study.card("u1", "c2"))
      assert.strictEqual(loaded.content.kind, "phrase")
      yield* study.updateCard({ ...loaded, due: 99_999, interval: 8 })
      assert.strictEqual(Option.getOrThrow(yield* study.card("u1", "c2")).interval, 8)

      assert.isTrue(yield* study.deleteNote("u1", "n1"))
      assert.isTrue(Option.isNone(yield* study.card("u1", "c2")))
    }))
})
