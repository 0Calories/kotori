import { assert, describe, layer } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import {
  CoachRepo,
  DictionaryRepo,
  EnrichmentRepo,
  type EntryRecord,
  JobsRepo,
  normalizeGloss,
  Repositories,
  StudyRepo,
  type UserRow,
  UsersRepo
} from "../src/index.ts"
import { DatabaseMemory } from "../src/testing.ts"

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

// Study ids are uuids, as Better Auth's user ids and the API's note and card ids are.
const U1 = "00000000-0000-4000-8000-000000000001"
const N1 = "00000000-0000-4000-8000-00000000000a"
const C1 = "00000000-0000-4000-8000-0000000000c1"
const C2 = "00000000-0000-4000-8000-0000000000c2"

describe("normalizeGloss", () => {
  layer(Layer.empty)((it) => {
    it.effect("strips infinitive markers, articles and parentheticals", () =>
      Effect.sync(() => {
        assert.strictEqual(normalizeGloss("to eat (a meal)"), "eat")
        assert.strictEqual(normalizeGloss("The Sun"), "sun")
        assert.strictEqual(normalizeGloss("(of a person) to be late"), "be late")
      })
    )
  })
})

layer(TestLayer)("DictionaryRepo", (it) => {
  it.effect("imports entries and reads them back in order", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries(entries)
      assert.strictEqual(yield* repo.count, 4)

      const [taberu] = yield* repo.getEntries([1358280])
      assert.strictEqual(taberu?.headword, "食べる")
      assert.deepStrictEqual(
        taberu?.forms.map((form) => form.text),
        ["食べる", "たべる"]
      )
      assert.strictEqual(taberu?.senses[1]?.glosses[0]?.text, "to live on (e.g. a salary)")
    })
  )

  it.effect("re-importing an entry replaces it", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries([{ ...entries[3]!, priority: 5 }])
      const [taiyaki] = yield* repo.getEntries([1000000])
      assert.strictEqual(taiyaki?.priority, 5)
      assert.strictEqual(taiyaki?.forms.length, 2)
    })
  )

  it.effect("finds Japanese forms exactly and by prefix", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const exact = yield* repo.findForms(["たべる"])
      assert.deepStrictEqual(
        exact.map((match) => match.entryId),
        [1358280]
      )
      assert.deepStrictEqual(yield* repo.findFormPrefix("た", 10), [1358280, 1000000])
    })
  )

  it.effect("searches English glosses with stemming and exact matching", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const fts = yield* repo.searchGlosses("eating", 20)
      assert.includeMembers(
        fts.map((match) => match.entryId),
        [1358280, 1269130, 1594790]
      )

      const exact = yield* repo.findGlossesExact("Eat", 20)
      assert.deepStrictEqual(
        exact.map((match) => match.entryId),
        [1358280, 1269130, 1594790]
      )
    })
  )

  it.effect("suggests words sharing a meaning as similar-word candidates", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const candidates = yield* repo.sharedGlossCandidates(1358280, 0, 10)
      assert.deepStrictEqual(
        candidates.map((c) => c.entryId),
        [1269130, 1594790]
      )
      assert.deepStrictEqual(yield* repo.sharedGlossCandidates(1358280, 1, 10), [])
    })
  )

  it.effect("lists entries missing enrichment in priority order", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      assert.deepStrictEqual(yield* repo.entriesByPriority({ limit: 2, missing: "nuance" }), [1358280, 1269130])
      assert.deepStrictEqual(
        yield* repo.entriesByPriority({ limit: 10, commonOnly: true }),
        [1358280, 1269130, 1594790]
      )
    })
  )
})

/** Jobs reference dictionary entries, so the queue tests need a few to point at. */
const stubEntries = (ids: ReadonlyArray<number>) =>
  Effect.flatMap(DictionaryRepo, (dictionary) =>
    dictionary.insertEntries(
      ids.map((id) => ({
        id,
        headword: `w${id}`,
        reading: `r${id}`,
        common: false,
        priority: 0,
        forms: [],
        senses: []
      }))
    )
  )

layer(TestLayer)("JobsRepo", (it) => {
  it.effect("claims the most urgent job once and retries failures", () =>
    Effect.gen(function* () {
      const jobs = yield* JobsRepo
      yield* stubEntries([1, 2, 3])
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
    })
  )

  it.effect("puts a job back without counting the attempt when its worker stops", () =>
    Effect.gen(function* () {
      const jobs = yield* JobsRepo
      yield* stubEntries([10])
      yield* jobs.enqueue("nuance", 10, 0, 1000)
      const claimed = Option.getOrThrow(yield* jobs.claim(["nuance"], 2000))
      assert.strictEqual(claimed.attempts, 1)

      yield* jobs.release(claimed.id, 2500)
      assert.strictEqual((yield* jobs.statusFor(10)).get("nuance"), "queued")
      const again = Option.getOrThrow(yield* jobs.claim(["nuance"], 3000))
      assert.strictEqual(again.id, claimed.id)
      assert.strictEqual(again.attempts, 1)
    })
  )
})

const learner: UserRow = {
  id: U1,
  status: "approved",
  role: "user",
  nativeLanguage: "en",
  targetLanguage: "ja",
  onboardedAt: null,
  displayName: null,
  timezone: "Asia/Tokyo",
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  createdAt: 0
}

layer(TestLayer)("StudyRepo", (it) => {
  it.effect("stores notes with cards and serves due queues", () =>
    Effect.gen(function* () {
      const users = yield* UsersRepo
      const study = yield* StudyRepo
      yield* users.ensure(learner)

      const card = (id: string, queue: "new" | "review", due: number) => ({
        id,
        noteId: N1,
        userId: U1,
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
          id: N1,
          userId: U1,
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
        [card(C1, "new", 0), { ...card(C2, "review", 500), template: "produce" }]
      )

      const notes = yield* study.notes(U1)
      assert.strictEqual(notes.length, 1)
      assert.strictEqual(notes[0]?.cards.length, 2)

      assert.deepStrictEqual(
        (yield* study.newCards(U1, 10)).map((c) => c.id),
        [C1]
      )
      assert.deepStrictEqual(
        (yield* study.reviewDue(U1, 1000, 10)).map((c) => c.id),
        [C2]
      )
      assert.deepStrictEqual(yield* study.reviewDue(U1, 100, 10), [])

      const loaded = Option.getOrThrow(yield* study.card(U1, C2))
      assert.strictEqual(loaded.content.kind, "phrase")
      yield* study.updateCard({ ...loaded, due: 99_999, interval: 8 })
      assert.strictEqual(Option.getOrThrow(yield* study.card(U1, C2)).interval, 8)

      // Answers are logged per study day and feed the statistics.
      yield* study.insertLog({
        cardId: C2,
        userId: U1,
        rating: "again",
        queueBefore: "review",
        intervalBefore: 3,
        interval: 1,
        easeBefore: 2.5,
        ease: 2.3,
        delayMs: 500,
        durationMs: 4200,
        reviewedAt: 1000,
        studyDay: 20_000
      })
      yield* study.insertLog({
        cardId: C1,
        userId: U1,
        rating: "good",
        queueBefore: "new",
        intervalBefore: 0,
        interval: 0,
        easeBefore: 0,
        ease: 2.5,
        delayMs: 0,
        durationMs: null,
        reviewedAt: 1100,
        studyDay: 20_000
      })
      assert.strictEqual(yield* study.countAnswers(U1, 20_000), 2)
      assert.strictEqual(yield* study.countAnswers(U1, 20_000, "new"), 1)
      assert.deepStrictEqual(yield* study.studyDays(U1), [20_000])
      assert.deepStrictEqual(yield* study.retention(U1, 19_000), { total: 1, failed: 1 })
      assert.deepStrictEqual(
        (yield* study.queueCounts(U1)).map((row) => `${row.queue}:${row.mature}:${row.n}`).sort(),
        ["new:false:1", "review:false:1"]
      )
      assert.strictEqual(yield* study.nextPosition(U1), 1)
      assert.deepStrictEqual(yield* study.reviewDueTimes(U1, 100_000), [99_999])

      assert.isTrue(yield* study.deleteNote(U1, N1))
      assert.isTrue(Option.isNone(yield* study.card(U1, C2)))
      assert.strictEqual(yield* study.noteCount(U1), 0)
    })
  )
})

layer(TestLayer)("UsersRepo", (it) => {
  it.effect("creates a profile once, updates it, and deletes it with everything the learner did", () =>
    Effect.gen(function* () {
      const users = yield* UsersRepo
      const coach = yield* CoachRepo
      const created = yield* users.ensure(learner)
      assert.strictEqual(created.status, "approved")
      // A second `ensure` keeps the existing row.
      const again = yield* users.ensure({ ...learner, status: "pending", displayName: "ignored" })
      assert.strictEqual(again.status, "approved")
      assert.isNull(again.displayName)

      const updated = yield* users.update(U1, { displayName: "Ash", onboardedAt: 5000, dailyNewLimit: 10 })
      assert.strictEqual(Option.getOrThrow(updated).displayName, "Ash")
      assert.strictEqual(Option.getOrThrow(updated).onboardedAt, 5000)
      assert.strictEqual(Option.getOrThrow(updated).dailyNewLimit, 10)
      assert.deepStrictEqual((yield* users.byIds([U1])).length, 1)

      yield* coach.recordUsage(U1, "naturalness", 1000)
      assert.strictEqual(yield* coach.usageSince(U1, 0), 1)
      yield* users.delete(U1)
      assert.isTrue(Option.isNone(yield* users.byId(U1)))
      assert.strictEqual(yield* coach.usageSince(U1, 0), 0)
    })
  )
})

layer(TestLayer)("CoachRepo", (it) => {
  it.effect("caches answers by key with a freshness bound", () =>
    Effect.gen(function* () {
      const coach = yield* CoachRepo
      yield* coach.store("k", { verdict: "natural", score: 90 }, 1000)
      assert.deepStrictEqual(Option.getOrThrow(yield* coach.cached("k", 500)), { verdict: "natural", score: 90 })
      assert.isTrue(Option.isNone(yield* coach.cached("k", 2000)))
      yield* coach.store("k", { verdict: "unnatural", score: 20 }, 3000)
      assert.deepStrictEqual(Option.getOrThrow(yield* coach.cached("k", 2000)), { verdict: "unnatural", score: 20 })
    })
  )
})

layer(TestLayer)("EnrichmentRepo", (it) => {
  it.effect("stores nuance, examples and audio per sense and replaces them on re-enrichment", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      yield* dictionary.insertEntries(entries)
      const taberu = 1358280
      const judgment = { value: "neutral" as const, confidence: 0.9, source: "jev" as const }
      const nuance = {
        formality: { value: "neutral" as const, position: 0.5, confidence: 0.9, source: "jev" as const },
        medium: { value: "both" as const, position: 0.5, confidence: 0.8, source: "jev" as const },
        keigo: { ...judgment, value: "none" as const },
        gender: judgment,
        age: { ...judgment, value: "any" as const },
        currency: { ...judgment, value: "current" as const },
        connotation: judgment,
        cautions: { rudeToSuperiors: 0.1, stiffWithFriends: 0.1, slang: 0.05 }
      }
      yield* enrichment.saveNuance(taberu, [{ sense: 0, nuance, answers: { raw: true }, model: "jev-1" }], 1000)
      assert.deepStrictEqual((yield* enrichment.nuanceFor([taberu]))[0]?.nuance, nuance)
      assert.deepStrictEqual(yield* dictionary.entriesByPriority({ limit: 1, missing: "nuance" }), [1269130])
      assert.deepStrictEqual(yield* dictionary.entriesByPriority({ limit: 10, enriched: "nuance" }), [taberu])

      yield* enrichment.saveSimilar(taberu, [
        { sense: 0, similarId: 1269130, similarity: 0.8, difference: "more_casual", confidence: 0.7 }
      ])
      assert.strictEqual((yield* enrichment.similarFor(taberu))[0]?.difference, "more_casual")

      const example = {
        ja: "ご飯を食べる",
        furigana: "ご{飯|はん}を{食|た}べる",
        en: "to eat a meal",
        note: null,
        model: "m"
      }
      yield* enrichment.saveExamples(taberu, [{ sense: 0, formality: "neutral", ...example }], 1000)
      const [first] = yield* enrichment.examplesFor([taberu])
      assert.strictEqual(first?.position, 0)

      // Examples written before voice casting carry no casting signals.
      assert.strictEqual(first?.speakerGender, null)
      assert.strictEqual(first?.variety, null)

      const clip = { key: "a".repeat(64), text: "食べる", language: "ja" as const, voiceId: "v", modelId: "m" }
      yield* enrichment.saveAudio({ ...clip, voice: "ja-kyoko", characters: 3, bytes: 10, createdAt: 1000 })
      yield* enrichment.linkEntryAudio(taberu, clip.key)
      yield* enrichment.linkExampleAudio(first!.id, "ja", clip.key, { castBy: "rules", score: 4 })
      assert.deepStrictEqual((yield* enrichment.entryAudio([taberu])).get(taberu), [
        { key: clip.key, voice: "ja-kyoko" }
      ])
      assert.strictEqual((yield* enrichment.exampleAudio([first!.id])).get(`${first!.id}:ja`), clip.key)
      assert.strictEqual(yield* enrichment.audioCharactersSince(500), 3)
      assert.strictEqual(yield* enrichment.audioCharactersSince(1500), 0)

      // A headword has one clip per dictionary voice; relinking the same clip is a no-op.
      const second = { ...clip, key: "b".repeat(64), voiceId: "w" }
      yield* enrichment.saveAudio({ ...second, voice: null, characters: 3, bytes: 10, createdAt: 1200 })
      yield* enrichment.linkEntryAudio(taberu, second.key)
      yield* enrichment.linkEntryAudio(taberu, clip.key)
      assert.deepStrictEqual(
        ((yield* enrichment.entryAudio([taberu])).get(taberu) ?? []).map((row) => row.key),
        [clip.key, second.key]
      )

      // Casting signals round-trip when the writer provides them.
      yield* enrichment.saveExamples(
        taberu,
        [
          {
            sense: 0,
            formality: "casual",
            ...example,
            speakerGender: "feminine",
            speakerAge: "youth",
            medium: "conversation",
            variety: "kansai",
            tone: "cheerful"
          }
        ],
        1500
      )
      const [cast] = yield* enrichment.examplesFor([taberu])
      assert.strictEqual(cast?.speakerGender, "feminine")
      assert.strictEqual(cast?.variety, "kansai")

      // Re-enriching replaces the examples; their audio links go with them.
      yield* enrichment.saveExamples(taberu, [{ sense: 1, formality: "polite", ...example }], 2000)
      const replaced = yield* enrichment.examplesFor([taberu])
      assert.strictEqual(replaced.length, 1)
      assert.strictEqual(replaced[0]?.sense, 1)
      assert.strictEqual((yield* enrichment.exampleAudio([first!.id])).size, 0)
      assert.isTrue(Option.isSome(yield* enrichment.findAudio(clip.key)))
    })
  )

  it.effect("keeps enrichment through a reseed, except for senses the entry lost", () =>
    Effect.gen(function* () {
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const taberu = 1358280
      // From the test above: nuance and a similar word on sense 0, an example on sense 1.
      yield* dictionary.insertEntries(entries)
      assert.strictEqual((yield* enrichment.nuanceFor([taberu])).length, 1)
      assert.strictEqual((yield* enrichment.similarFor(taberu)).length, 1)
      assert.strictEqual((yield* enrichment.examplesFor([taberu])).length, 1)
      const [reseeded] = yield* dictionary.getEntries([taberu])
      assert.strictEqual(reseeded?.senses[1]?.glosses.length, 2)

      yield* dictionary.insertEntries([{ ...entries[0]!, senses: [sense(["to eat", "to have a meal"])] }])
      assert.strictEqual((yield* enrichment.nuanceFor([taberu])).length, 1)
      assert.strictEqual((yield* enrichment.examplesFor([taberu])).length, 0)
      const [shrunk] = yield* dictionary.getEntries([taberu])
      assert.deepStrictEqual(
        shrunk?.senses.map((s) => s.glosses.map((gloss) => gloss.text)),
        [["to eat", "to have a meal"]]
      )
    })
  )
})
