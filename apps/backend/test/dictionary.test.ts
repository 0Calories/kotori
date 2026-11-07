import { assert, layer } from "@effect/vitest"
import {
  Claude,
  ClaudeError,
  ElevenLabs,
  ENGLISH_QUESTIONS_VERSION,
  interpretSense,
  Jev,
  JevError,
  Pronouncer,
  QUESTIONS_VERSION,
  type SenseAnswers,
  TtsError
} from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "../src/db/Database.ts"
import { linkEntryAudio, linkExampleAudio, saveAudio } from "../src/features/audio/queries.ts"
import { Dictionary } from "../src/features/dictionary/Dictionary.ts"
import { insertEntries, saveTags } from "../src/features/dictionary/queries.ts"
import {
  claimJob,
  completeJob,
  type JobKind,
  enqueueJob,
  failJob,
  jobStatusFor
} from "../src/features/enrichment/jobs.ts"
import {
  examplesFor,
  saveExamples,
  saveLoanTrap,
  saveLoanWord,
  saveNuance,
  saveSenseNotes,
  saveSimilar
} from "../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

// The dictionary service on PGlite with audio configured, so it queues audio jobs; nothing is synthesised.

const providers = (jevConfigured: boolean, claudeAvailable = false) =>
  Layer.mergeAll(
    Layer.succeed(
      Claude,
      Claude.of({
        model: "test",
        available: Effect.succeed(claudeAvailable),
        generate: () => Effect.fail(new ClaudeError({ reason: "unconfigured", message: "not configured" }))
      })
    ),
    Pronouncer.layer
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          Jev,
          Jev.of({
            configured: jevConfigured,
            model: "test",
            ask: () => Effect.fail(new JevError({ message: "not called in tests" }))
          })
        ),
        Layer.succeed(
          ElevenLabs,
          ElevenLabs.of({
            configured: true,
            model: "test",
            synthesize: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not in tests" }))
          })
        )
      )
    )
  )

const testLayer = (jevConfigured: boolean, claudeAvailable = false) =>
  Dictionary.layer.pipe(
    Layer.provideMerge(providers(jevConfigured, claudeAvailable)),
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
  id: EntryId.make(id),
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
    readonly spellings?: ReadonlyArray<string>
    readonly inflections?: ReadonlyArray<readonly [string, ReadonlyArray<string>]>
  } = {}
): EntryRecord => ({
  id: EntryId.make(id),
  language: "en",
  headword,
  reading: options.reading ?? "",
  common: options.common ?? true,
  priority: options.priority ?? 50,
  forms: [
    { kind: "spelling", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    ...(options.spellings ?? []).map((text) => ({
      kind: "spelling" as const,
      text,
      common: false,
      tags: [],
      priorities: [],
      restrictions: [],
      noKanji: false
    })),
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
  createdAt: new Date(0)
})

/** Runs every queued job of `kind` to completion, as a worker would. */
const finishJobs = (kind: JobKind, now: number) =>
  Effect.gen(function* () {
    const db = yield* Database
    while (true) {
      const job = yield* claimJob(db, [kind], new Date(now))
      if (Option.isNone(job)) return
      yield* completeJob(db, job.value.id, new Date(now))
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
      const db = yield* Database
      yield* insertEntries(db, [
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
      const db = yield* Database
      yield* insertEntries(db, [
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

  it.effect("ranks English words glossed with the kanji of a kana query above glosses that only contain it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const hage: EntryRecord = {
        ...entry(
          1455410,
          "禿",
          "はげ",
          [sense(["baldness", "bald head"], ["n"]), sense(["bald person", "baldy"], ["n"], ["derog", "uk"])],
          true
        ),
        priority: 40,
        forms: [
          {
            kind: "kanji",
            text: "禿",
            common: true,
            tags: [],
            priorities: ["ichi1"],
            restrictions: [],
            noKanji: false
          },
          {
            kind: "kanji",
            text: "禿げ",
            common: false,
            tags: ["io"],
            priorities: [],
            restrictions: [],
            noKanji: false
          },
          {
            kind: "kana",
            text: "はげ",
            common: true,
            tags: [],
            priorities: ["ichi1"],
            restrictions: [],
            noKanji: false
          },
          { kind: "kana", text: "ハゲ", common: true, tags: [], priorities: ["spec1"], restrictions: [], noKanji: true }
        ]
      }
      yield* insertEntries(db, [
        hage,
        // Imperative lookalikes for はげ → はぐ (剥ぐ, and obscure 接ぐ read はぐ) must not hijack ハゲ/はげ.
        entry(1582990, "剥ぐ", "はぐ", [sense(["to tear off", "to peel off", "to strip off"], ["v5g", "vt"])]),
        entry(2429160, "接ぐ", "はぐ", [sense(["to join (cloth, wood, etc.)"], ["v5g", "vt"])], false),
        // As Wiktionary and JMDict gloss them: bald in its の-modifier form, baldy and baldness with the headword 禿.
        word(100000100, "bald", [sense(["禿げの", "禿げ頭の"], ["adj"])], { priority: 77 }),
        word(100000101, "baldy", [sense(["禿"], ["n"])], { common: false, priority: 60 }),
        word(100000102, "baldness", [sense(["禿", "裸", "禿髪", "脱毛症", "禿頭", "台湾ハゲ"], ["n"])], {
          common: false,
          priority: 47
        }),
        word(100000103, "strip off", [sense(["剥ぐ", "はがす"], ["v"])], { priority: 69 }),
        word(100000104, "connect", [sense(["繫げる", "接ぐ", "接続する"], ["v"])], { priority: 85 }),
        // ハゲタカ is a vulture, not a bald person: a gloss that only contains the query.
        word(100000105, "vulture", [sense(["ハゲタカ", "ハゲワシ", "禿鷹"], ["n"])], { priority: 71 }),
        word(100000106, "buzzard", [sense(["のすり"], ["n"]), sense(["はげたか"], ["n"])], {
          common: false,
          priority: 60
        })
      ])
      const dictionary = yield* Dictionary
      const headwords = (query: string) =>
        Effect.map(dictionary.search(query, "en", 10), (res) => res.entries.map((summary) => summary.headword))

      // ハゲ and はげ reach 禿げの (bald) and 禿 (baldy, baldness) as exact kanji spellings, ahead of
      // contained glosses (ハゲタカ, はげたか), without imperative lookalikes (剥ぐ, 接ぐ) intruding.
      assert.deepStrictEqual(yield* headwords("ハゲ"), ["bald", "baldy", "baldness", "vulture"])
      assert.deepStrictEqual(yield* headwords("はげ"), ["bald", "baldy", "baldness", "buzzard"])
      assert.deepStrictEqual(yield* headwords("hage"), ["bald", "baldy", "baldness"])
      // Kanji in, kanji out: the 禿 of 禿鷹 doesn't make vulture an answer for 禿.
      assert.deepStrictEqual(yield* headwords("禿"), ["bald", "baldy", "baldness", "vulture"])
      assert.deepStrictEqual(yield* headwords("禿げ"), ["bald", "baldy", "baldness"])
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

  it.effect("finds JMDict entries written with fullwidth Latin characters when searched in ASCII", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        entry(1032910, "ＯＢ", "オー・ビー", [sense(["old boy", "alumnus", "out of bounds"], ["n"])]),
        entry(1032920, "ＯＢ会", "オービーかい", [sense(["alumni association"], ["n"])], false),
        entry(1039000, "Ｔシャツ", "ティーシャツ", [sense(["T-shirt"], ["n"])]),
        entry(1019350, "ＩＮ", "イン", [sense(["in"], ["n"])], false),
        entry(1423310, "中", "なか", [sense(["inside", "in"], ["n"])])
      ])

      for (const query of ["OB", "ob", "ＯＢ"]) {
        const res = yield* dictionary.search(query, "ja", 10)
        assert.strictEqual(res.mode, "japanese")
        assert.deepStrictEqual(
          res.entries.slice(0, 2).map((summary) => summary.headword),
          ["ＯＢ", "ＯＢ会"]
        )
      }

      for (const query of ["Tシャツ", "Ｔシャツ"]) {
        const res = yield* dictionary.search(query, "ja", 10)
        assert.strictEqual(res.mode, "japanese")
        assert.strictEqual(res.entries[0]?.headword, "Ｔシャツ")
      }

      const inSearch = yield* dictionary.search("in", "ja", 10)
      assert.strictEqual(inSearch.mode, "english")
      assert.strictEqual(inSearch.entries[0]?.headword, "中")
    })
  )

  it.effect("assembles an English word as an entry, voiced and cross-referenced in English", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [
        word(100000020, "dine", [sense(["食事をする"], ["v"])]),
        word(
          100000021,
          "consume",
          [{ ...sense(["消費する"], ["v", "vt"], ["form"]), xrefs: ["Dine"], dialects: ["en-GB"] }],
          { reading: "/kənˈsjuːm/", inflections: [["consumed", ["past", "past-participle"]]] }
        )
      ])
      yield* saveTags(db, [{ code: "form", label: "formal or literary term" }])
      yield* saveExamples(
        db,
        EntryId.make(100000021),
        [example(0, "電気を使いすぎる。", "We consume too much power.")],
        new Date(0)
      )
      const [written] = yield* examplesFor(db, [EntryId.make(100000021)])
      yield* saveAudio(db, clip("consume", "consume", "en"))
      yield* linkEntryAudio(db, EntryId.make(100000021), "consume")
      yield* saveAudio(db, clip("sentence-en", "We consume too much power.", "en"))
      yield* linkExampleAudio(db, written!.id, "en", "sentence-en")

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
      const db = yield* Database
      const dictionary = yield* Dictionary
      const audioStatus = Effect.map(dictionary.requestEnrichment(EntryId.make(20)), (s) => Option.getOrThrow(s).audio)
      const hour = 60 * 60 * 1000
      yield* insertEntries(db, [entry(20, "食べる", "たべる", [sense(["to eat"], ["v1"])])])

      // Voiced before its examples were written: the headword only.
      yield* saveAudio(db, clip("headword", "たべる", "ja"))
      yield* linkEntryAudio(db, EntryId.make(20), "headword")
      yield* enqueueJob(db, "audio", EntryId.make(20), 0, new Date(0))
      yield* finishJobs("audio", 1)
      yield* saveExamples(db, EntryId.make(20), [example(0, "パンを食べる。", "I eat bread.")], new Date(1))
      const [written] = yield* examplesFor(db, [EntryId.make(20)])

      // Looking at it later queues the job again to fill the gap.
      yield* TestClock.setTime(2 * hour)
      assert.strictEqual(yield* audioStatus, "queued")
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(20))).get("audio"), "queued")

      // The worker runs but can't fill it: the entry isn't queued again on every look,
      // and its audio stops counting as on its way, so the app stops polling.
      yield* finishJobs("audio", 2 * hour)
      yield* TestClock.setTime(2 * hour + 3000)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(20))).get("audio"), "done")

      // An hour on, it gets one more try.
      yield* TestClock.setTime(3 * hour + 1)
      assert.strictEqual(yield* audioStatus, "queued")

      // Once the sentence is voiced in Japanese, the entry's audio is complete and nothing is queued again.
      yield* saveAudio(db, clip("sentence-ja", "パンを食べる。", "ja"))
      yield* linkExampleAudio(db, written!.id, "ja", "sentence-ja")
      yield* finishJobs("audio", 3 * hour + 2)
      yield* TestClock.setTime(10 * hour)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(20))).get("audio"), "done")
    })
  )

  it.effect("reports a failed audio job as unavailable so polling stops, then retries after ten minutes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const id = EntryId.make(21)
      const minute = 60 * 1000
      const audioStatus = Effect.map(dictionary.requestEnrichment(id), (s) => Option.getOrThrow(s).audio)
      yield* insertEntries(db, [entry(21, "爆睡", "ばくすい", [sense(["sleeping like a log"], ["n", "vs"])])])

      // First look queues audio; all three worker attempts fail.
      yield* TestClock.setTime(0)
      assert.strictEqual(yield* audioStatus, "queued")
      for (const tick of [1000, 2000, 3000]) {
        const claimed = Option.getOrThrow(yield* claimJob(db, ["audio"], new Date(tick)))
        yield* failJob(db, claimed.id, "budget reached", new Date(tick + 500), new Date(tick))
      }

      // A poll 3 seconds later sees unavailable instead of reviving the failed job in a loop.
      yield* TestClock.setTime(6000)
      assert.strictEqual(yield* audioStatus, "unavailable")
      assert.strictEqual((yield* jobStatusFor(db, id)).get("audio"), "failed")

      // Ten minutes later, a fresh visit gives the job another try.
      yield* TestClock.setTime(11 * minute)
      assert.strictEqual(yield* audioStatus, "queued")
      assert.strictEqual((yield* jobStatusFor(db, id)).get("audio"), "queued")
    })
  )

  it.effect("finds multi-word phrases across pronoun variations, missing words and typos", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        entry(1222000, "気に障る", "きにさわる", [sense(["to get on one's nerves", "to irritate"], ["exp", "v5r"])]),
        entry(1600000, "癇に障る", "かんにさわる", [sense(["to get on someone's nerves"], ["exp", "v5r"])]),
        entry(1700000, "薄氷を踏む", "はくひょうをふむ", [sense(["to skate on thin ice"], ["exp", "v5m"])]),
        entry(1800000, "朝飯前", "あさめしまえ", [sense(["piece of cake"], ["n"])]),
        word(100000070, "get on one's nerves", [sense(["神経に障る", "イライラさせる"], ["v"])]),
        word(100000071, "wrap one's head around", [sense(["理解する"], ["v"])]),
        word(100000072, "piece of cake", [sense(["朝飯前"], ["n"])])
      ])

      const headwords = (query: string, language: "ja" | "en") =>
        Effect.map(dictionary.search(query, language, 10), (res) => res.entries.map((e) => e.headword))

      // Japanese dictionary (English native speaker): "my", omitted pronoun, "someone's", inflected verb, or typo.
      for (const query of [
        "get on my nerves",
        "get on nerves",
        "get on someone's nerves",
        "getting on my nerves",
        "get on my neves",
        "got on my nerves"
      ]) {
        assert.includeMembers(yield* headwords(query, "ja"), ["気に障る", "癇に障る"])
      }
      // (k-1)-of-k relaxed token search + trigram similarity when one word in a phrase is swapped or misspelled.
      assert.include(yield* headwords("walk on thin ice", "ja"), "薄氷を踏む")
      assert.include(yield* headwords("peice of cake", "ja"), "朝飯前")

      // English dictionary: phrase headwords found with "my", omitted pronoun, inflected verb, or typo.
      for (const query of ["get on my nerves", "get on nerves", "getting on my nerves", "get on my neves"]) {
        assert.include(yield* headwords(query, "en"), "get on one's nerves")
      }
      assert.include(yield* headwords("wrap head around", "en"), "wrap one's head around")
      assert.include(yield* headwords("wrapped my head around", "en"), "wrap one's head around")
      assert.include(yield* headwords("peice of cake", "en"), "piece of cake")
    })
  )

  it.effect("resolves canonical English idioms across verb variants, inflections, typos, and Japanese glosses", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const headwords = (query: string, language: "ja" | "en") =>
        Effect.map(dictionary.search(query, language, 10), (res) => res.entries.map((e) => e.headword))

      yield* insertEntries(db, [
        word(100000073, "throw on", [sense(["急いで着る"], ["v"])]),
        word(100000074, "think of", [sense(["思いつく"], ["v"])])
      ])
      assert.deepStrictEqual(yield* headwords("on thin ice", "en"), [])

      yield* insertEntries(db, [
        word(
          100000075,
          "on thin ice",
          [sense(["危うい立場にある", "危険な状態にある", "薄氷を踏む思いで"], ["adj"], ["id"])],
          {
            reading: "/ɒn θɪn aɪs/",
            priority: 70,
            spellings: ["skate on thin ice", "tread on thin ice", "walk on thin ice"],
            inflections: [
              ["skating on thin ice", ["present-participle"]],
              ["treading on thin ice", ["present-participle"]],
              ["walking on thin ice", ["present-participle"]]
            ]
          }
        )
      ])
      for (const query of [
        "on thin ice",
        "walk on thin ice",
        "skating on thin ice",
        "step on thin ice",
        "on thin ise",
        "薄氷を踏む"
      ]) {
        assert.strictEqual((yield* headwords(query, "en"))[0], "on thin ice", `expected "on thin ice" for "${query}"`)
      }
    })
  )

  it.effect("corrects typos in English words and phrases without drowning romaji or adding noise", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        entry(1900000, "傘", "かさ", [sense(["umbrella"], ["n"])]),
        entry(1900001, "食べる", "たべる", [sense(["to eat"], ["v1"])]),
        entry(1900002, "テーブル", "てーぶる", [sense(["table"], ["n"])]),
        entry(1900003, "神経に障る", "しんけいにさわる", [sense(["to get on one's nerves"], ["exp", "v5r"])]),
        word(100000080, "umbrella", [sense(["傘"], ["n"])]),
        word(100000081, "umbra", [sense(["本影"], ["n"])]),
        word(100000082, "get on one's nerves", [sense(["神経に障る"], ["v"])]),
        word(100000083, "neck", [sense(["首"], ["n"])])
      ])
      const search = (query: string, language: "ja" | "en") =>
        Effect.map(dictionary.search(query, language, 10), (res) => ({
          mode: res.mode,
          headwords: res.entries.map((e) => e.headword)
        }))

      assert.include((yield* search("get on my nervs", "ja")).headwords, "神経に障る")
      assert.include((yield* search("get on one's nervs", "en")).headwords, "get on one's nerves")
      assert.include((yield* search("umbrela", "ja")).headwords, "傘")
      // umbra is a trigram match too, but too far below umbrella to show.
      assert.deepStrictEqual((yield* search("umbrela", "en")).headwords, ["umbrella"])

      // "taberu" is near "table", but a word it spells in romaji comes first.
      const taberu = yield* search("taberu", "ja")
      assert.strictEqual(taberu.mode, "romaji")
      assert.strictEqual(taberu.headwords[0], "食べる")
      const neko = yield* search("neko", "en")
      assert.notInclude(neko.headwords, "neck")

      // With a word of the phrase swapped, the gloss with the rest side by side ranks first.
      yield* insertEntries(db, [
        entry(1900004, "かき氷", "かきごおり", [sense(["ice shaved into thin flakes"], ["n"])]),
        // A second gloss costs 薄氷 4 points, which only proximity makes up.
        entry(1900005, "薄氷", "はくひょう", [sense(["thin ice", "precarious situation"], ["n"])])
      ])
      const thinIce = (yield* search("walk on thin ice", "ja")).headwords
      assert.isBelow(thinIce.indexOf("薄氷"), thinIce.indexOf("かき氷"))
      assert.notStrictEqual(thinIce.indexOf("薄氷"), -1)

      assert.deepStrictEqual((yield* search("xqzvy", "ja")).headwords, [])
      assert.deepStrictEqual((yield* search("xqzvy", "en")).headwords, [])
    })
  )

  it.effect("says whether the results answer the query or only resemble it, and how current a word is", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        word(100000090, "bus", [sense(["バス"], ["n"])], { inflections: [["bussing", ["present-participle"]]] }),
        word(100000091, "business", [sense(["仕事"], ["n"])]),
        // As the import writes it, with the framed JMDict gloss as a spelling.
        word(100000092, "stone's throw", [sense(["目と鼻の先"], ["exp"], ["id"])], {
          common: false,
          spellings: ["stone's throw away"]
        }),
        entry(1900010, "食べる", "たべる", [sense(["to eat"], ["v1"])]),
        entry(1900011, "食べ物", "たべもの", [sense(["food"], ["n"])])
      ])
      yield* saveNuance(
        db,
        EntryId.make(100000092),
        [
          {
            sense: 0,
            nuance: interpretSense(senseAnswers, ["dated"]),
            answers: senseAnswers,
            model: "test",
            questionsVersion: ENGLISH_QUESTIONS_VERSION
          }
        ],
        new Date(0)
      )
      const match = (query: string, language: "ja" | "en") =>
        Effect.map(dictionary.search(query, language, 10), (result) => result.match)

      // The word itself, its inflection, or a phrase with every word of the query.
      assert.strictEqual(yield* match("bus", "en"), "exact")
      assert.strictEqual(yield* match("bussing", "en"), "exact")
      assert.strictEqual(yield* match("a stone's throw", "en"), "exact")
      assert.strictEqual(yield* match("a stone's throw away", "en"), "exact")
      // With the phrase's words but not the phrase: only a word-dropped near miss.
      assert.strictEqual(yield* match("stone throw", "en"), "weak")
      // Lookalikes alone: a prefix of "business" and the inflection "bussing" by trigram.
      const bussin = yield* dictionary.search("bussin", "en", 10)
      assert.strictEqual(bussin.match, "weak")
      assert.include(
        bussin.entries.map((summary) => summary.headword),
        "bus"
      )
      assert.strictEqual(yield* match("xqzvy", "en"), "none")

      // The same for learners of Japanese, by form and by gloss.
      assert.strictEqual(yield* match("食べる", "ja"), "exact")
      assert.strictEqual(yield* match("食べ", "ja"), "weak")
      assert.strictEqual(yield* match("eat", "ja"), "exact")
      assert.strictEqual(yield* match("xqzvy", "ja"), "none")

      const stonesThrow = yield* dictionary.search("stone's throw", "en", 10)
      assert.strictEqual(stonesThrow.entries[0]?.currency, "dated")
      assert.strictEqual(bussin.entries[0]?.currency, null)
    })
  )

  it.effect("reaches Japanese words through the English dictionary's glosses when JMDict's own miss them", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        // JMDict has these, but never glossed as "the ick".
        entry(2858544, "蛙化現象", "かえるかげんしょう", [sense(["frogification phenomenon"], ["n"])], false),
        entry(2195830, "ドン引き", "どんびき", [sense(["being completely turned off"], ["n"])], false),
        entry(1591290, "きっかけ", "きっかけ", [sense(["chance", "start"], ["n"])]),
        // The English dictionary's "ick", glossed as the real one is (data/eiwa/enwiktionary-ja.jsonl,
        // CC BY-SA 4.0: see data/eiwa/NOTICE.md), and an acronym spelled the same.
        word(100010602, "ick", [
          sense(["(恋愛対象などに突然冷める)ドン引きポイント", "蛙化現象のきっかけ", "生理的嫌悪感"], ["n"], ["col"]),
          sense(["うわっ", "げっ", "キモい"], ["int"], ["col"])
        ]),
        word(100040207, "ICK", [sense(["インヒビターシスチンノット"], ["n"])])
      ])
      // No gloss is a JMDict form whole, but the longest word inside each is: lookalikes, not answers.
      const inside = yield* dictionary.search("ick", "ja", 10)
      assert.strictEqual(inside.match, "weak")
      assert.includeMembers(
        inside.entries.map((summary) => summary.headword),
        ["蛙化現象", "ドン引き"]
      )
      // Only the longest word inside a gloss, earliest first: not the きっかけ of 蛙化現象のきっかけ.
      assert.notInclude(
        inside.entries.map((summary) => summary.headword),
        "きっかけ"
      )

      // A gloss that is a JMDict form whole, reached from the query as written, answers it.
      yield* insertEntries(db, [entry(2013005, "キモい", "きもい", [sense(["gross", "disgusting"], ["adj-i"])], false)])
      const whole = yield* dictionary.search("ick", "ja", 10)
      assert.strictEqual(whole.match, "exact")
      assert.strictEqual(whole.entries[0]?.headword, "キモい")
      // Through a guess at the base form, the same words are only lookalikes.
      const guessed = yield* dictionary.search("icks", "ja", 10)
      assert.strictEqual(guessed.match, "weak")
      assert.includeMembers(
        guessed.entries.map((summary) => summary.headword),
        ["キモい", "蛙化現象"]
      )
    })
  )
})

layer(testLayer(false))("Dictionary: what Kotori wrote on an English word", (it) => {
  it.effect("shows its usage note for Japanese speakers and its katakana loan", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [word(100000040, "style", [sense(["様式", "流儀"], ["n"])])])
      yield* saveSenseNotes(
        db,
        EntryId.make(100000040),
        [{ sense: 0, note: null, noteJa: "建物や文章の「様式」に使う。", model: "test" }],
        new Date(0)
      )
      const shown = Effect.map(dictionary.entry(EntryId.make(100000040)), Option.getOrThrow)
      assert.strictEqual((yield* shown).senses[0]?.noteJa, "建物や文章の「様式」に使う。")
      assert.isNull((yield* shown).loan)

      const verdict = { value: "divergent" as const, probability: 0.9, source: "jev" as const }
      yield* saveLoanWord(
        db,
        EntryId.make(100000040),
        { word: "スタイル", verdict, answers: {}, model: "test", questionsVersion: ENGLISH_QUESTIONS_VERSION },
        new Date(0)
      )
      yield* saveLoanTrap(db, EntryId.make(100000040), "スタイル", "日本語の「スタイル」は体型を指すことが多いです。")
      assert.deepStrictEqual((yield* shown).loan, {
        word: "スタイル",
        verdict,
        trap: "日本語の「スタイル」は体型を指すことが多いです。"
      })

      // Candidates asked about, none judged the loan: nothing to show.
      yield* saveLoanWord(
        db,
        EntryId.make(100000040),
        { word: null, verdict: null, answers: {}, model: "test", questionsVersion: ENGLISH_QUESTIONS_VERSION },
        new Date(1)
      )
      assert.isNull((yield* shown).loan)
    })
  )

  it.effect("shows a similar word by the meaning it shares with the sense, not by its first", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        word(100000050, "tension", [sense(["（精神的な）緊張", "不安"], ["n"]), sense(["張力"], ["n"])]),
        word(100000051, "strain", [sense(["（遺伝的な）性質", "気質"], ["n"]), sense(["緊張", "重圧"], ["n"])]),
        word(100000052, "stress", [sense(["圧力", "圧迫"], ["n"])])
      ])
      yield* saveSimilar(db, EntryId.make(100000050), [
        {
          sense: 0,
          similarId: EntryId.make(100000051),
          similarity: 0.9,
          difference: "different_usage",
          confidence: 0.8
        },
        // Found through a cross-reference: no gloss in common, so its first meanings.
        { sense: 0, similarId: EntryId.make(100000052), similarity: 0.8, difference: "more_general", confidence: 0.8 }
      ])
      const tension = Option.getOrThrow(yield* dictionary.entry(EntryId.make(100000050)))
      assert.deepStrictEqual(
        tension.senses[0]?.similar.map((similar) => [similar.headword, similar.meaning]),
        [
          ["strain", "緊張、重圧"],
          ["stress", "圧力、圧迫"]
        ]
      )
    })
  )
})

layer(testLayer(true))("Dictionary with Jev configured", (it) => {
  it.effect("queues a finished nuance job again once its answers predate the word's question set, once", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const nuanceStatus = (id: EntryId) =>
        Effect.map(dictionary.requestEnrichment(id), (s) => Option.getOrThrow(s).nuance)
      const nuanceJob = (id: EntryId) => Effect.map(jobStatusFor(db, id), (status) => status.get("nuance"))
      const judge = (id: EntryId, questionsVersion: number) =>
        saveNuance(
          db,
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
          new Date(0)
        )
      yield* insertEntries(db, [
        entry(30, "食べる", "たべる", [sense(["to eat"], ["v1"])]),
        word(100000030, "eat", [sense(["食べる"], ["v"])])
      ])

      // Each judged, and its job finished, under the question set before its language's current one.
      for (const [id, version] of [
        [EntryId.make(30), QUESTIONS_VERSION],
        [EntryId.make(100000030), ENGLISH_QUESTIONS_VERSION]
      ] as const) {
        yield* judge(id, version - 1)
        yield* enqueueJob(db, "nuance", id, 0, new Date(0))
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
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [word(100000031, "kid", [sense(["子供"], ["n"]), sense(["仔やぎ"], ["n"])])])
      // Judged when 仔やぎ led: its row followed it to the second sense, and 子供 has none.
      yield* saveNuance(
        db,
        EntryId.make(100000031),
        [
          {
            sense: 1,
            nuance: interpretSense(senseAnswers, []),
            answers: senseAnswers,
            model: "test",
            questionsVersion: ENGLISH_QUESTIONS_VERSION
          }
        ],
        new Date(0)
      )
      yield* enqueueJob(db, "nuance", EntryId.make(100000031), 0, new Date(0))
      yield* finishJobs("nuance", 1)
      yield* dictionary.requestEnrichment(EntryId.make(100000031))
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(100000031))).get("nuance"), "queued")
    })
  )
})

layer(testLayer(true, true))("Dictionary with Jev and Claude", (it) => {
  it.effect("queues a judged word again for a loan warning Claude couldn't write, not on every look", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const minute = 60 * 1000
      const nuanceJob = Effect.map(jobStatusFor(db, EntryId.make(100000060)), (status) => status.get("nuance"))
      const look = (at: number) =>
        TestClock.setTime(at).pipe(Effect.andThen(dictionary.requestEnrichment(EntryId.make(100000060))))
      yield* insertEntries(db, [word(100000060, "mansion", [sense(["大邸宅"], ["n"])])])
      yield* saveNuance(
        db,
        EntryId.make(100000060),
        [
          {
            sense: 0,
            nuance: interpretSense(senseAnswers, []),
            answers: senseAnswers,
            model: "test",
            questionsVersion: ENGLISH_QUESTIONS_VERSION
          }
        ],
        new Date(0)
      )
      // Judged while Claude was unavailable: a confident verdict, no warning.
      const verdict = { value: "divergent" as const, probability: 0.9, source: "jev" as const }
      yield* saveLoanWord(
        db,
        EntryId.make(100000060),
        { word: "マンション", verdict, answers: {}, model: "test", questionsVersion: ENGLISH_QUESTIONS_VERSION },
        new Date(0)
      )
      yield* enqueueJob(db, "nuance", EntryId.make(100000060), 0, new Date(0))
      yield* finishJobs("nuance", 0)

      // Right after the job, a look leaves it; ten minutes on, it is queued for the warning.
      yield* look(5 * minute)
      assert.strictEqual(yield* nuanceJob, "done")
      yield* look(11 * minute)
      assert.strictEqual(yield* nuanceJob, "queued")

      // Ran, but Claude still couldn't write it: not again on the next look.
      yield* finishJobs("nuance", 11 * minute)
      yield* look(12 * minute)
      assert.strictEqual(yield* nuanceJob, "done")

      // Once written, nothing more is queued.
      yield* saveLoanTrap(db, EntryId.make(100000060), "マンション", "日本語の「マンション」は集合住宅です。")
      yield* look(60 * minute)
      assert.strictEqual(yield* nuanceJob, "done")
    })
  )
})

layer(testLayer(true))("Dictionary with Jev, and Claude unavailable", (it) => {
  it.effect("doesn't queue a word for a loan warning while Claude can't write it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [word(100000061, "mansion", [sense(["大邸宅"], ["n"])])])
      yield* saveNuance(
        db,
        EntryId.make(100000061),
        [
          {
            sense: 0,
            nuance: interpretSense(senseAnswers, []),
            answers: senseAnswers,
            model: "test",
            questionsVersion: ENGLISH_QUESTIONS_VERSION
          }
        ],
        new Date(0)
      )
      const verdict = { value: "divergent" as const, probability: 0.9, source: "jev" as const }
      yield* saveLoanWord(
        db,
        EntryId.make(100000061),
        { word: "マンション", verdict, answers: {}, model: "test", questionsVersion: ENGLISH_QUESTIONS_VERSION },
        new Date(0)
      )
      yield* enqueueJob(db, "nuance", EntryId.make(100000061), 0, new Date(0))
      yield* finishJobs("nuance", 0)
      yield* TestClock.setTime(60 * 60 * 1000)
      yield* dictionary.requestEnrichment(EntryId.make(100000061))
      assert.strictEqual((yield* jobStatusFor(db, EntryId.make(100000061))).get("nuance"), "done")
    })
  )
})
