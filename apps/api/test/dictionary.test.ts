import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, JobsRepo, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { EntryId } from "@kotori/domain"
import { Jev, JevError } from "@kotori/nuance"
import { Pronouncer, TtsError } from "@kotori/tts"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Dictionary } from "../src/services/Dictionary.ts"

// The dictionary service on PGlite with audio configured, so it queues audio jobs; nothing is synthesised.

const Providers = Layer.mergeAll(
  Layer.succeed(
    Claude,
    Claude.of({
      model: "test",
      available: Effect.succeed(false),
      generate: () => Effect.fail(new ClaudeError({ reason: "unconfigured", message: "not configured" }))
    })
  ),
  Layer.succeed(
    Jev,
    Jev.of({ configured: false, model: "test", ask: () => Effect.fail(new JevError({ message: "not configured" })) })
  ),
  Layer.succeed(
    Pronouncer,
    Pronouncer.of({
      configured: true,
      exampleLanguages: ["ja", "en"],
      speak: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not in tests" })),
      enrichEntry: () => Effect.succeed({ clips: 0, characters: 0 })
    })
  )
)

const TestLayer = Dictionary.layer.pipe(
  Layer.provideMerge(Providers),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseMemory)
)

const sense = (glosses: Array<string>, pos: Array<string>, misc: Array<string> = []) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos,
  misc,
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: []
})

const entry = (
  id: number,
  headword: string,
  reading: string,
  senses: EntryRecord["senses"],
  common = true
): EntryRecord => ({
  id,
  headword,
  reading,
  common,
  priority: common ? 50 : 0,
  forms: [
    { kind: "kanji", text: headword, common, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses
})

const example = (sense: number, ja: string, en: string) => ({
  sense,
  ja,
  furigana: ja,
  en,
  formality: "casual" as const,
  note: null,
  noteJa: "「awkward」は人間関係の気まずさにも使える。",
  model: "test"
})

const clip = (key: string, text: string, language: "ja" | "en") => ({
  key,
  text,
  language,
  voiceId: "voice",
  voice: null,
  modelId: "model",
  characters: text.length,
  bytes: 1,
  createdAt: 0
})

/** Runs every queued audio job to completion, as a worker would. */
const finishAudioJobs = (now: number) =>
  Effect.gen(function* () {
    const jobs = yield* JobsRepo
    while (true) {
      const job = yield* jobs.claim(["audio"], now)
      if (Option.isNone(job)) return
      yield* jobs.complete(job.value.id, now)
    }
  })

layer(TestLayer)("Dictionary", (it) => {
  it.effect("looks up an English word as the Japanese words that mean it, most likely first", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      yield* repo.insertEntries([
        entry(10, "気まずい", "きまずい", [sense(["awkward", "uncomfortable"], ["adj-i"])]),
        entry(11, "不器用", "ぶきよう", [sense(["clumsy"], ["adj-na"]), sense(["awkward", "unskillful"], ["adj-na"])]),
        entry(12, "ぎこちない", "ぎこちない", [sense(["awkward", "stiff"], ["adj-i"])], false),
        entry(13, "気まぐれ", "きまぐれ", [sense(["whim"], ["n"])])
      ])
      yield* enrichment.saveExamples(10, [example(0, "気まずい沈黙が続いた。", "There was an awkward silence.")], 0)

      const dictionary = yield* Dictionary
      const awkward = yield* dictionary.english("  awkward ")
      assert.strictEqual(awkward.term, "awkward")
      assert.deepStrictEqual(
        awkward.meanings.map((meaning) => [meaning.headword, meaning.sense]),
        [
          ["気まずい", 0],
          ["不器用", 1],
          ["ぎこちない", 0]
        ]
      )
      assert.deepStrictEqual(awkward.meanings[1]?.glosses, ["awkward", "unskillful"])
      assert.deepStrictEqual(
        awkward.meanings.map((meaning) => meaning.glosses[meaning.matched]),
        ["awkward", "awkward", "awkward"]
      )
      assert.strictEqual(awkward.meanings[0]?.examples[0]?.en, "There was an awkward silence.")
      assert.strictEqual(awkward.meanings[0]?.examples[0]?.noteJa, "「awkward」は人間関係の気まずさにも使える。")
      // Audio is configured, so looking the word up queued it for the leading meanings. Claude
      // isn't, so no examples are being written.
      assert.isTrue(awkward.waiting)
      assert.isFalse(awkward.writing)
      assert.strictEqual((yield* (yield* JobsRepo).statusFor(10)).get("audio"), "queued")

      const search = yield* dictionary.search("awkward", 10)
      assert.isTrue(search.englishWord)
      assert.isFalse((yield* dictionary.search("awk", 10)).englishWord)
      assert.isFalse((yield* dictionary.search("気まずい", 10)).englishWord)

      assert.deepStrictEqual((yield* dictionary.english("nothing like it")).meanings, [])
    })
  )

  it.effect("voices examples again when a finished audio job left the English unvoiced, at most hourly", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const dictionary = yield* Dictionary
      const audioStatus = Effect.map(dictionary.requestEnrichment(EntryId.make(20)), (s) => Option.getOrThrow(s).audio)
      const hour = 60 * 60 * 1000
      yield* repo.insertEntries([entry(20, "食べる", "たべる", [sense(["to eat"], ["v1"])])])
      yield* enrichment.saveExamples(20, [example(0, "パンを食べる。", "I eat bread.")], 0)
      const [written] = yield* enrichment.examplesFor([20])

      // Voiced before English was: the headword and the Japanese sentence only.
      yield* enrichment.saveAudio(clip("headword", "たべる", "ja"))
      yield* enrichment.saveAudio(clip("sentence-ja", "パンを食べる。", "ja"))
      yield* enrichment.linkEntryAudio(20, "headword")
      yield* enrichment.linkExampleAudio(written!.id, "ja", "sentence-ja")
      yield* jobs.enqueue("audio", 20, 0, 0)
      yield* finishAudioJobs(1)

      // Looking at it later queues the job again to fill the gap.
      yield* TestClock.setTime(2 * hour)
      assert.strictEqual(yield* audioStatus, "queued")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "queued")

      // The worker runs but can't fill it: the entry isn't queued again on every look,
      // and its audio stops counting as on its way, so the app stops polling.
      yield* finishAudioJobs(2 * hour)
      yield* TestClock.setTime(2 * hour + 3000)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "done")

      // An hour on, it gets one more try.
      yield* TestClock.setTime(3 * hour + 1)
      assert.strictEqual(yield* audioStatus, "queued")

      // Once English is voiced too, the entry's audio is complete and nothing is queued again.
      yield* enrichment.saveAudio(clip("sentence-en", "I eat bread.", "en"))
      yield* enrichment.linkExampleAudio(written!.id, "en", "sentence-en")
      yield* finishAudioJobs(3 * hour + 2)
      yield* TestClock.setTime(10 * hour)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "done")
    })
  )
})
