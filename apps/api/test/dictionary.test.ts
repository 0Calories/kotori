import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, type JobKind, JobsRepo, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { type EnglishJudgments, EntryId } from "@kotori/domain"
import { interpretSense, Jev, JevError, QUESTIONS_VERSION, type SenseAnswers } from "@kotori/nuance"
import { Pronouncer, TtsError } from "@kotori/tts"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Dictionary } from "../src/services/Dictionary.ts"

// The dictionary service on PGlite with audio configured, so it queues audio jobs; nothing is synthesised.

const providers = (jevConfigured: boolean) =>
  Layer.mergeAll(
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
      Jev.of({
        configured: jevConfigured,
        model: "test",
        ask: () => Effect.fail(new JevError({ message: "not in tests" }))
      })
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

const testLayer = (jevConfigured: boolean) =>
  Dictionary.layer.pipe(
    Layer.provideMerge(providers(jevConfigured)),
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

const judged = <A extends string>(value: A) => ({ value, confidence: 0.9, source: "jev" as const })

const englishJudgments: EnglishJudgments = {
  variety: judged("universal"),
  strength: judged("none"),
  currency: judged("current"),
  register: judged("neutral"),
  loan: judged("no_loan")
}

const score = (value: number) => ({ type: "score", score: value, confidence: 0.9, legend: {}, probabilities: {} })
const choice = (value: string) => ({ type: "choice", choice: value, confidence: 0.8, probabilities: {} })

const senseAnswers = {
  formality: score(2),
  medium: score(1),
  keigo: choice("none"),
  gender: choice("neutral"),
  age: choice("any"),
  currency: choice("current"),
  connotation: choice("neutral"),
  rudeToSuperiors: { type: "noul", noul: 0.1 },
  slang: { type: "noul", noul: 0.02 }
} as unknown as SenseAnswers

/** Runs every queued job of a kind to completion, as a worker would. */
const finishJobs = (kind: JobKind, now: number) =>
  Effect.gen(function* () {
    const jobs = yield* JobsRepo
    while (true) {
      const job = yield* jobs.claim([kind], now)
      if (Option.isNone(job)) return
      yield* jobs.complete(job.value.id, now)
    }
  })

layer(testLayer(false))("Dictionary", (it) => {
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

  it.effect("shows English judgments only for the gloss Jev judged", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const dictionary = yield* Dictionary
      yield* repo.insertEntries([entry(14, "純真", "じゅんしん", [sense(["pure", "naive", "innocent"], ["adj-na"])])])
      yield* enrichment.saveEnglishNuance(
        14,
        [{ sense: 0, nuance: englishJudgments, answers: {}, model: "test", questionsVersion: QUESTIONS_VERSION }],
        0
      )
      const meaning = (term: string) =>
        Effect.map(dictionary.english(term), (found) => found.meanings.find((m) => m.entryId === EntryId.make(14)))

      // The English-side questions judged "pure", the first gloss: on the "naive" page
      // they would describe a different word.
      assert.strictEqual((yield* meaning("pure"))?.english?.variety.value, "universal")
      const naive = yield* meaning("naive")
      assert.strictEqual(naive?.glosses[naive.matched], "naive")
      assert.isNull(naive?.english)
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
      yield* finishJobs("audio", 1)

      // Looking at it later queues the job again to fill the gap.
      yield* TestClock.setTime(2 * hour)
      assert.strictEqual(yield* audioStatus, "queued")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "queued")

      // The worker runs but can't fill it: the entry isn't queued again on every look,
      // and its audio stops counting as on its way, so the app stops polling.
      yield* finishJobs("audio", 2 * hour)
      yield* TestClock.setTime(2 * hour + 3000)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "done")

      // An hour on, it gets one more try.
      yield* TestClock.setTime(3 * hour + 1)
      assert.strictEqual(yield* audioStatus, "queued")

      // Once English is voiced too, the entry's audio is complete and nothing is queued again.
      yield* enrichment.saveAudio(clip("sentence-en", "I eat bread.", "en"))
      yield* enrichment.linkExampleAudio(written!.id, "en", "sentence-en")
      yield* finishJobs("audio", 3 * hour + 2)
      yield* TestClock.setTime(10 * hour)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "done")
    })
  )
})

layer(testLayer(true))("Dictionary with Jev configured", (it) => {
  it.effect("queues a finished nuance job again once its answers predate the question set, once", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const dictionary = yield* Dictionary
      const nuanceStatus = Effect.map(
        dictionary.requestEnrichment(EntryId.make(30)),
        (s) => Option.getOrThrow(s).nuance
      )
      const nuanceJob = Effect.map(jobs.statusFor(30), (status) => status.get("nuance"))
      const judge = (questionsVersion: number) =>
        enrichment.saveNuance(
          30,
          [
            {
              sense: 0,
              nuance: interpretSense(senseAnswers, []),
              answers: senseAnswers,
              model: "test",
              questionsVersion
            }
          ],
          0
        )
      yield* repo.insertEntries([entry(30, "食べる", "たべる", [sense(["to eat"], ["v1"])])])

      // Judged, and the job finished, under the previous question set.
      yield* judge(QUESTIONS_VERSION - 1)
      yield* jobs.enqueue("nuance", 30, 0, 0)
      yield* finishJobs("nuance", 1)

      // Looking at the entry queues it again, while the old judgments stay on show.
      assert.strictEqual(yield* nuanceStatus, "ready")
      assert.strictEqual(yield* nuanceJob, "queued")

      // Once it has judged with the current questions, looking again queues nothing.
      yield* judge(QUESTIONS_VERSION)
      yield* finishJobs("nuance", 2)
      assert.strictEqual(yield* nuanceStatus, "ready")
      assert.strictEqual(yield* nuanceJob, "done")
    })
  )
})
