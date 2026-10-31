import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type EntryRecord, type JobKind, JobsRepo, Repositories } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { EntryId } from "@kotori/domain"
import {
  ENGLISH_QUESTIONS_VERSION,
  interpretSense,
  Jev,
  JevError,
  QUESTIONS_VERSION,
  type SenseAnswers
} from "@kotori/nuance"
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
        ask: () => Effect.fail(new JevError({ message: "not called in tests" }))
      })
    ),
    Layer.succeed(
      Pronouncer,
      Pronouncer.of({
        configured: true,
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
  antonyms: [],
  sources: [],
  wasei: false
})

const entry = (
  id: number,
  headword: string,
  reading: string,
  senses: EntryRecord["senses"],
  common = true
): EntryRecord => ({
  id,
  language: "ja",
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

/** An English word, with Japanese glosses, its inflections and other spellings. */
const word = (
  id: number,
  headword: string,
  senses: EntryRecord["senses"],
  options: {
    readonly reading?: string
    readonly common?: boolean
    readonly priority?: number
    readonly inflections?: ReadonlyArray<readonly [string, ReadonlyArray<string>]>
  } = {}
): EntryRecord => ({
  id,
  language: "en",
  headword,
  reading: options.reading ?? "",
  common: options.common ?? true,
  priority: options.priority ?? 50,
  forms: [
    { kind: "spelling", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    ...(options.inflections ?? []).map(([text, tags]) => ({
      kind: "inflection" as const,
      text,
      common: false,
      tags: [...tags],
      priorities: [],
      restrictions: [],
      noKanji: false
    }))
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

/** Runs every queued job of `kind` to completion, as a worker would. */
const finishJobs = (kind: JobKind, now: number) =>
  Effect.gen(function* () {
    const jobs = yield* JobsRepo
    while (true) {
      const job = yield* jobs.claim([kind], now)
      if (Option.isNone(job)) return
      yield* jobs.complete(job.value.id, now)
    }
  })

const answer = { confidence: 0.9, probabilities: {} }
/** A sense's answers as Jev gives them, for storing judged nuance. */
const senseAnswers = {
  formality: { type: "score", score: 2, legend: {}, ...answer },
  medium: { type: "score", score: 1, legend: {}, ...answer },
  keigo: { type: "choice", choice: "none", ...answer },
  gender: { type: "choice", choice: "neutral", ...answer },
  age: { type: "choice", choice: "any", ...answer },
  currency: { type: "choice", choice: "current", ...answer },
  connotation: { type: "choice", choice: "neutral", ...answer },
  rudeToSuperiors: { type: "noul", noul: 0.1 },
  slang: { type: "noul", noul: 0.05 }
} as unknown as SenseAnswers

layer(testLayer(false))("Dictionary", (it) => {
  it.effect("searches English words for Japanese speakers by spelling, inflection and prefix", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries([
        word(100000001, "eat", [sense(["～を食べる。"], ["v", "vt"]), sense(["食事をする"], ["v", "vi"])], {
          reading: "/iːt/",
          priority: 90,
          inflections: [
            ["ate", ["past"]],
            ["eaten", ["past-participle"]]
          ]
        }),
        word(100000002, "eatery", [sense(["食堂"], ["n"])], { common: false, priority: 10 }),
        word(100000003, "team", [sense(["チーム"], ["n"]), sense(["チームを組む"], ["v"])]),
        // An acronym spelled the same, inflected like a word: another word altogether.
        word(100000004, "START", [sense(["戦略兵器削減交渉"], ["n"], ["abbr"])], {
          priority: 95,
          inflections: [["STARTed", ["past"]]]
        }),
        word(100000005, "start", [sense(["始める"], ["v"])], { priority: 60 }),
        // A Japanese word glossed "eat" is in the other dictionary and never comes up.
        entry(1358280, "食べる", "たべる", [sense(["to eat"], ["v1"])])
      ])
      const dictionary = yield* Dictionary

      const eat = yield* dictionary.search("eat", "en", 10)
      assert.strictEqual(eat.mode, "english")
      assert.deepStrictEqual(
        eat.entries.map((summary) => [summary.headword, summary.language]),
        [
          ["eat", "en"],
          ["eatery", "en"]
        ]
      )
      assert.deepStrictEqual(eat.entries[0]?.meanings, ["～を食べる。", "食事をする"])
      assert.strictEqual(eat.entries[0]?.reading, "/iːt/")
      assert.strictEqual(eat.entries[0]?.romaji, "")

      // Inflections lead to their word, marked with what they are, the way 食べなかった leads to 食べる.
      const ate = yield* dictionary.search("Ate", "en", 10)
      assert.deepStrictEqual(
        ate.entries.map((summary) => [summary.headword, summary.inflection]),
        [["eat", ["past"]]]
      )
      // "started" is start's past before it is the acronym's, however common the acronym.
      const started = yield* dictionary.search("started", "en", 10)
      assert.deepStrictEqual(
        started.entries.map((summary) => summary.headword),
        ["start", "START"]
      )
      // Words whose sources list no forms are reached by the regular rules.
      const teams = yield* dictionary.search("teams", "en", 10)
      assert.deepStrictEqual(
        teams.entries.map((summary) => [summary.headword, summary.inflection]),
        [["team", ["plural"]]]
      )
    })
  )

  it.effect("finds English words for a Japanese query by their glosses and through JMDict", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries([
        entry(1155020, "気まずい", "きまずい", [sense(["unpleasant", "awkward", "embarrassing"], ["adj-i"])]),
        entry(1009310, "猫", "ねこ", [sense(["cat"], ["n"])]),
        word(100000010, "awkward", [sense(["ぎこちない"], ["adj"])], { priority: 60 }),
        word(100000011, "unpleasant", [sense(["不愉快な"], ["adj"])], { priority: 40 }),
        word(100000012, "cat", [sense(["猫"], ["n"])], { priority: 70 }),
        word(100000013, "pretty", [sense(["きれいな"], ["adj"]), sense(["かなり"], ["adv"])], { priority: 80 }),
        word(100000014, "uncomfortable", [sense(["気まずい思いをした"], ["adj"])], { common: false, priority: 5 })
      ])
      const dictionary = yield* Dictionary

      // 気まずい is no English word's gloss, but JMDict glosses it "unpleasant" and "awkward",
      // which come first, the more used ahead; a gloss that only contains it comes after.
      const kimazui = yield* dictionary.search("気まずい", "en", 10)
      assert.strictEqual(kimazui.mode, "japanese")
      assert.deepStrictEqual(
        kimazui.entries.map((summary) => summary.headword),
        ["awkward", "unpleasant", "uncomfortable"]
      )

      // Kana reaches cat through 猫's JMDict entry; an adjectival noun finds its "な" gloss.
      assert.strictEqual((yield* dictionary.search("ねこ", "en", 10)).entries[0]?.headword, "cat")
      assert.strictEqual((yield* dictionary.search("きれい", "en", 10)).entries[0]?.headword, "pretty")

      // Rōmaji that isn't an English word is read as Japanese.
      const neko = yield* dictionary.search("neko", "en", 10)
      assert.deepStrictEqual([neko.mode, neko.reading, neko.entries[0]?.headword], ["romaji", "ねこ", "cat"])
    })
  )

  it.effect("keeps learners of Japanese in the Japanese dictionary", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      const eat = yield* dictionary.search("eat", "ja", 10)
      assert.deepStrictEqual(
        eat.entries.map((summary) => [summary.headword, summary.language]),
        [["食べる", "ja"]]
      )
      assert.notInclude(
        (yield* dictionary.search("猫", "ja", 10)).entries.map((summary) => summary.headword),
        "cat"
      )
    })
  )

  it.effect("assembles an English word as an entry, voiced and cross-referenced in English", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      yield* repo.insertEntries([
        word(100000020, "dine", [sense(["食事をする"], ["v"])]),
        word(
          100000021,
          "consume",
          [{ ...sense(["消費する"], ["v", "vt"], ["form"]), xrefs: ["Dine"], dialects: ["en-GB"] }],
          { reading: "/kənˈsjuːm/", inflections: [["consumed", ["past", "past-participle"]]] }
        )
      ])
      yield* repo.saveTags([{ code: "form", label: "formal or literary term" }])
      yield* enrichment.saveExamples(100000021, [example(0, "電気を使いすぎる。", "We consume too much power.")], 0)
      const [written] = yield* enrichment.examplesFor([100000021])
      yield* enrichment.saveAudio(clip("consume", "consume", "en"))
      yield* enrichment.linkEntryAudio(100000021, "consume")
      yield* enrichment.saveAudio(clip("sentence-en", "We consume too much power.", "en"))
      yield* enrichment.linkExampleAudio(written!.id, "en", "sentence-en")

      const consume = Option.getOrThrow(yield* (yield* Dictionary).entry(EntryId.make(100000021)))
      assert.strictEqual(consume.language, "en")
      assert.strictEqual(consume.reading, "/kənˈsjuːm/")
      assert.strictEqual(consume.romaji, "")
      assert.deepStrictEqual(
        consume.forms.map((form) => [form.kind, form.text, form.tags.map((tag) => tag.code)]),
        [
          ["spelling", "consume", []],
          ["inflection", "consumed", ["past", "past-participle"]]
        ]
      )
      assert.deepStrictEqual(consume.senses[0]?.glosses, ["消費する"])
      assert.deepStrictEqual(consume.senses[0]?.misc, [{ code: "form", label: "formal or literary term" }])
      // Its synonym links to the English word, whatever the case it was written in.
      assert.deepStrictEqual(consume.senses[0]?.related, [{ text: "Dine", entryId: EntryId.make(100000020) }])
      assert.strictEqual(consume.audioUrl, "/audio/consume.mp3")
      assert.strictEqual(consume.senses[0]?.examples[0]?.translationAudioUrl, "/audio/sentence-en.mp3")
      // Voiced in English, which is all an English word needs: its audio is complete.
      assert.strictEqual(consume.enrichment.audio, "ready")
    })
  )

  it.effect("links coach vocabulary to words in the learner's target language", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      assert.deepStrictEqual(
        yield* dictionary.lookupWords(
          [
            { word: "Dine", reading: "Dine" },
            { word: "consumed", reading: "consumed" },
            { word: "nonexistent", reading: "nonexistent" }
          ],
          "en"
        ),
        [EntryId.make(100000020), EntryId.make(100000021), null]
      )
      assert.deepStrictEqual(yield* dictionary.lookupWords([{ word: "猫", reading: "ねこ" }], "ja"), [
        EntryId.make(1009310)
      ])
    })
  )

  it.effect("voices examples again when a finished audio job left one unvoiced, at most hourly", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const dictionary = yield* Dictionary
      const audioStatus = Effect.map(dictionary.requestEnrichment(EntryId.make(20)), (s) => Option.getOrThrow(s).audio)
      const hour = 60 * 60 * 1000
      yield* repo.insertEntries([entry(20, "食べる", "たべる", [sense(["to eat"], ["v1"])])])

      // Voiced before its examples were written: the headword only.
      yield* enrichment.saveAudio(clip("headword", "たべる", "ja"))
      yield* enrichment.linkEntryAudio(20, "headword")
      yield* jobs.enqueue("audio", 20, 0, 0)
      yield* finishJobs("audio", 1)
      yield* enrichment.saveExamples(20, [example(0, "パンを食べる。", "I eat bread.")], 1)
      const [written] = yield* enrichment.examplesFor([20])

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

      // Once the sentence is voiced in Japanese, the entry's audio is complete and nothing is queued again.
      yield* enrichment.saveAudio(clip("sentence-ja", "パンを食べる。", "ja"))
      yield* enrichment.linkExampleAudio(written!.id, "ja", "sentence-ja")
      yield* finishJobs("audio", 3 * hour + 2)
      yield* TestClock.setTime(10 * hour)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobs.statusFor(20)).get("audio"), "done")
    })
  )
})

layer(testLayer(false))("Dictionary: what Kotori wrote on an English word", (it) => {
  it.effect("shows its usage note for Japanese speakers and its katakana loan", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const dictionary = yield* Dictionary
      yield* repo.insertEntries([word(100000040, "style", [sense(["様式", "流儀"], ["n"])])])
      yield* enrichment.saveSenseNotes(
        100000040,
        [{ sense: 0, note: null, noteJa: "建物や文章の「様式」に使う。", model: "test" }],
        0
      )
      const shown = Effect.map(dictionary.entry(EntryId.make(100000040)), Option.getOrThrow)
      assert.strictEqual((yield* shown).senses[0]?.noteJa, "建物や文章の「様式」に使う。")
      assert.isNull((yield* shown).loan)

      const verdict = { value: "diverges" as const, confidence: 0.9, source: "jev" as const }
      yield* enrichment.saveLoanWord(
        100000040,
        { word: "スタイル", verdict, answers: {}, model: "test", questionsVersion: ENGLISH_QUESTIONS_VERSION },
        0
      )
      yield* enrichment.saveLoanTrap(100000040, "スタイル", "日本語の「スタイル」は体型を指すことが多いです。")
      assert.deepStrictEqual((yield* shown).loan, {
        word: "スタイル",
        verdict,
        trap: "日本語の「スタイル」は体型を指すことが多いです。"
      })

      // Candidates asked about, none judged the loan: nothing to show.
      yield* enrichment.saveLoanWord(
        100000040,
        { word: null, verdict: null, answers: {}, model: "test", questionsVersion: ENGLISH_QUESTIONS_VERSION },
        1
      )
      assert.isNull((yield* shown).loan)
    })
  )
})

layer(testLayer(true))("Dictionary with Jev configured", (it) => {
  it.effect("queues a finished nuance job again once its answers predate the word's question set, once", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const dictionary = yield* Dictionary
      const nuanceStatus = (id: number) =>
        Effect.map(dictionary.requestEnrichment(EntryId.make(id)), (s) => Option.getOrThrow(s).nuance)
      const nuanceJob = (id: number) => Effect.map(jobs.statusFor(id), (status) => status.get("nuance"))
      const judge = (id: number, questionsVersion: number) =>
        enrichment.saveNuance(
          id,
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
      yield* repo.insertEntries([
        entry(30, "食べる", "たべる", [sense(["to eat"], ["v1"])]),
        word(100000030, "eat", [sense(["食べる"], ["v"])])
      ])

      // Each judged, and its job finished, under the question set before its language's current one.
      for (const [id, version] of [
        [30, QUESTIONS_VERSION],
        [100000030, ENGLISH_QUESTIONS_VERSION]
      ] as const) {
        yield* judge(id, version - 1)
        yield* jobs.enqueue("nuance", id, 0, 0)
        yield* finishJobs("nuance", 1)

        // Looking at the entry queues it again, while the old judgments stay on show.
        assert.strictEqual(yield* nuanceStatus(id), "ready")
        assert.strictEqual(yield* nuanceJob(id), "queued")

        // Once it has judged with the current questions, looking again queues nothing.
        yield* judge(id, version)
        yield* finishJobs("nuance", 2)
        assert.strictEqual(yield* nuanceStatus(id), "ready")
        assert.strictEqual(yield* nuanceJob(id), "done")
      }
    })
  )

  it.effect("queues an entry again when a judged sense has no judgment, as after a re-import ranks it in", () =>
    Effect.gen(function* () {
      const repo = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jobs = yield* JobsRepo
      const dictionary = yield* Dictionary
      yield* repo.insertEntries([word(100000031, "kid", [sense(["子供"], ["n"]), sense(["仔やぎ"], ["n"])])])
      // Judged when 仔やぎ led: its row followed it to the second sense, and 子供 has none.
      yield* enrichment.saveNuance(
        100000031,
        [
          {
            sense: 1,
            nuance: interpretSense(senseAnswers, []),
            answers: senseAnswers,
            model: "test",
            questionsVersion: ENGLISH_QUESTIONS_VERSION
          }
        ],
        0
      )
      yield* jobs.enqueue("nuance", 100000031, 0, 0)
      yield* finishJobs("nuance", 1)
      yield* dictionary.requestEnrichment(EntryId.make(100000031))
      assert.strictEqual((yield* jobs.statusFor(100000031)).get("nuance"), "queued")
    })
  )
})
