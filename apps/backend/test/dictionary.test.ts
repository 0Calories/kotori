import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError, ElevenLabs, Jev, JevError, Pronouncer, TtsError } from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { cautions, jobs, usagePatterns } from "@kotori/db"
import { inArray } from "drizzle-orm"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "../src/db/Database.ts"
import { linkEntryAudio, linkExampleAudio, saveAudio } from "../src/features/audio/queries.ts"
import { Dictionary } from "../src/features/dictionary/Dictionary.ts"
import { insertEntries, linkLoans, saveTags } from "../src/features/dictionary/queries.ts"
import {
  claimJob,
  completeJob,
  type JobKind,
  enqueueJob,
  failJob,
  jobStatusFor
} from "../src/features/enrichment/jobs.ts"
import { declineCasting, examplesFor, saveCasting, saveExamples } from "../src/features/enrichment/queries.ts"
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
  origins: [],
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
  source: "jmdict",
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
  source: "enwiktionary",
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

/** A one-sense word with a Tatoeba sentence, as the seed import gives it. */
const seededEntry = (id: number, headword: string, reading: string, sentence: string) => {
  const record = entry(id, headword, reading, [sense(["rain"], ["n"])])
  return {
    ...record,
    senses: record.senses.map((own) => ({
      ...own,
      examples: [{ ja: sentence, en: `(${sentence})`, source: "tatoeba" as const }]
    }))
  }
}

/** The entry's examples job ran and Kotori wrote no sentence: its seeded sentences are the examples learners hear. */
const triedExamples = (entryId: EntryId) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* db.insert(jobs).values({ kind: "examples", entryId, status: "done", updatedAt: new Date(0) })
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

layer(testLayer(false))("Dictionary", (it) => {
  it.effect("searches English words for English learners by spelling, inflection and prefix", () =>
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

  it.effect("keeps Japanese learners in the Japanese dictionary", () =>
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
      yield* saveTags(db, [{ code: "form", name: "formal or literary term" }])
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
      // Its one sense's labels, the region among them, are the word's.
      assert.deepStrictEqual(
        consume.labels.map((label) => label.code),
        ["en-GB", "form"]
      )
      // Its synonym links to the English word, whatever the case it was written in.
      assert.deepStrictEqual(consume.senses[0]?.related, [{ text: "Dine", entryId: EntryId.make(100000020) }])
      assert.strictEqual(consume.audioUrl, "/audio/consume.mp3")
      assert.strictEqual(consume.senses[0]?.examples[0]?.translationAudioUrl, "/audio/sentence-en.mp3")
      // Voiced in English, which is all an English word needs: its audio is complete.
      assert.strictEqual(consume.enrichment.audio, "ready")
      // Search results carry the headword clip too, so they can be heard without opening the entry.
      const results = yield* (yield* Dictionary).search("consume", "en", 10)
      const heard = results.entries.find((entry) => entry.id === EntryId.make(100000021))
      assert.strictEqual(heard?.audioUrl, "/audio/consume.mp3")
      const dine = (yield* (yield* Dictionary).search("dine", "en", 10)).entries.find(
        (entry) => entry.id === EntryId.make(100000020)
      )
      assert.strictEqual(dine?.audioUrl, null)
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

  it.effect("runs a finished audio job again for a sentence written since, not for one it couldn't voice", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const audioStatus = Effect.map(dictionary.requestEnrichment(EntryId.make(20)), (s) => Option.getOrThrow(s).audio)
      const audioJob = Effect.map(jobStatusFor(db, EntryId.make(20)), (jobs) => jobs.get("audio"))
      const hour = 60 * 60 * 1000
      yield* insertEntries(db, [entry(20, "食べる", "たべる", [sense(["to eat"], ["v1"])])])

      // Voiced before its examples were written: the headword only.
      yield* saveAudio(db, clip("headword", "たべる", "ja"))
      yield* linkEntryAudio(db, EntryId.make(20), "headword")
      yield* enqueueJob(db, "audio", EntryId.make(20), 0, new Date(0))
      yield* finishJobs("audio", 1)
      yield* saveExamples(db, EntryId.make(20), [example(0, "パンを食べる。", "I eat bread.")], new Date(2))

      // Looking at it later queues the job again to voice the new sentence.
      yield* TestClock.setTime(2 * hour)
      assert.strictEqual(yield* audioStatus, "queued")
      assert.strictEqual(yield* audioJob, "queued")

      // The worker runs but can't voice it: its audio stops counting as on its way, so the app
      // stops polling, and it isn't queued again on later looks, an hour on or a day on.
      yield* finishJobs("audio", 2 * hour)
      for (const later of [2 * hour + 3000, 3 * hour + 1, 26 * hour]) {
        yield* TestClock.setTime(later)
        assert.strictEqual(yield* audioStatus, "unavailable")
        assert.strictEqual(yield* audioJob, "done")
      }

      // Another sentence written since is tried once more.
      yield* saveExamples(
        db,
        EntryId.make(20),
        [example(0, "パンを食べる。", "I eat bread."), example(0, "朝ご飯を食べた。", "I had breakfast.")],
        new Date(27 * hour)
      )
      yield* TestClock.setTime(27 * hour + 1)
      assert.strictEqual(yield* audioStatus, "queued")
      yield* finishJobs("audio", 27 * hour + 2)

      // Once every sentence is voiced in Japanese, the entry's audio is complete and nothing is queued again.
      for (const [index, written] of (yield* examplesFor(db, [EntryId.make(20)])).entries()) {
        yield* saveAudio(db, clip(`sentence-${index}`, written.ja, "ja"))
        yield* linkExampleAudio(db, written.id, "ja", `sentence-${index}`)
      }
      yield* TestClock.setTime(40 * hour)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual(yield* audioJob, "done")
    })
  )

  it.effect("doesn't hold the audio back for seeded sentences when Jev can't judge them", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const id = EntryId.make(31)
      yield* insertEntries(db, [seededEntry(31, "雪", "ゆき", "雪が降る。")], { seeded: true })
      yield* saveAudio(db, clip("yuki", "ゆき", "ja"))
      yield* linkEntryAudio(db, id, "yuki")
      // Without Jev nobody can judge its register, and none is assumed: it stays unvoiced.
      assert.strictEqual(Option.getOrThrow(yield* dictionary.requestEnrichment(id)).audio, "ready")
      assert.isUndefined((yield* jobStatusFor(db, id)).get("audio"))
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

      // Japanese dictionary (Japanese learner): "my", omitted pronoun, "someone's", inflected verb, or typo.
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

  it.effect("says whether the results answer the query or only resemble it, and what labels a word carries", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* insertEntries(db, [
        word(100000090, "bus", [sense(["バス"], ["n"])], { inflections: [["bussing", ["present-participle"]]] }),
        word(100000091, "business", [sense(["仕事"], ["n"])]),
        // As the import writes it, with the framed JMDict gloss as a spelling.
        word(100000092, "stone's throw", [sense(["目と鼻の先"], ["exp"], ["id", "dated"])], {
          common: false,
          spellings: ["stone's throw away"]
        }),
        entry(1900010, "食べる", "たべる", [sense(["to eat"], ["v1"])]),
        entry(1900011, "食べ物", "たべもの", [sense(["food"], ["n"])])
      ])
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

      // The same for Japanese learners, by form and by gloss.
      assert.strictEqual(yield* match("食べる", "ja"), "exact")
      assert.strictEqual(yield* match("食べ", "ja"), "weak")
      assert.strictEqual(yield* match("eat", "ja"), "exact")
      assert.strictEqual(yield* match("xqzvy", "ja"), "none")

      const stonesThrow = yield* dictionary.search("stone's throw", "en", 10)
      assert.deepStrictEqual(
        stonesThrow.entries[0]?.labels.map((label) => [label.code, label.severity]),
        [
          ["dated", "warning"],
          ["id", "quiet"]
        ]
      )
      assert.deepStrictEqual(bussin.entries[0]?.labels, [])
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
        // The English dictionary's "ick", glossed as the real one is (data/english/enwiktionary-ja.jsonl,
        // CC BY-SA 4.0: see data/english/NOTICE.md), and an acronym spelled the same.
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

// The enrichment model as the entry page reads it: the dictionary's labels stated once, usage patterns
// and cautions with the words they name, frequency, the loan link from either end, and similar
// words derived from shared glosses and cross-references.
layer(testLayer(false))("Dictionary: labels, usage patterns, cautions and similar words", (it) => {
  const taberu = EntryId.make(1358280)
  const kuu = EntryId.make(1269130)
  const meshiagaru = EntryId.make(1594790)
  const gokurou = EntryId.make(1270560)
  const mansion = EntryId.make(1079450)
  const mansionEn = EntryId.make(100000060)
  const eat = EntryId.make(100000061)
  const dine = EntryId.make(100000062)

  const seed = Effect.gen(function* () {
    const db = yield* Database
    yield* insertEntries(
      db,
      [
        {
          ...entry(taberu, "食べる", "たべる", [sense(["to eat"], ["v1"]), sense(["to live on"], ["v1"])]),
          priority: 90
        },
        {
          ...entry(kuu, "食う", "くう", [
            sense(["to eat"], ["v5u"], ["male"]),
            sense(["to bite"], ["v5u"], ["male", "col"])
          ]),
          priority: 80,
          frequency: { everyday: true, spokenCount: null, score: null }
        },
        {
          ...entry(meshiagaru, "召し上がる", "めしあがる", [sense(["to eat", "to drink"], ["v5r"], ["hon"])]),
          priority: 60
        },
        entry(gokurou, "ご苦労様", "ごくろうさま", [
          { ...sense(["thank you for your hard work"], ["exp"], ["pol"]), info: ["usu. to one's subordinate"] }
        ]),
        {
          ...entry(mansion, "マンション", "マンション", [
            { ...sense(["condominium"], ["n"]), origins: [{ language: "eng", word: "mansion" }] }
          ])
        },
        word(Number(mansionEn), "mansion", [sense(["大邸宅"], ["n"])]),
        word(Number(eat), "eat", [sense(["食べる"], ["v"]), { ...sense(["食事をする"], ["v"]), xrefs: ["dine"] }]),
        word(Number(dine), "dine", [sense(["食事をする", "正餐を取る"], ["v"], ["form"])], { common: false })
      ],
      { seeded: true }
    )
    yield* linkLoans(db)
  })

  it.effect("states the word's labels once, and a sense only what it adds", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      yield* seed
      const shown = Option.getOrThrow(yield* dictionary.entry(kuu))
      assert.deepStrictEqual(shown.labels, [{ code: "male", severity: "warning", source: "jmdict" }])
      assert.deepStrictEqual(
        shown.senses.map((own) => own.labels.map((label) => label.code)),
        [[], ["col"]]
      )
      assert.strictEqual(shown.source, "jmdict")
      assert.deepStrictEqual(shown.frequency, { everyday: true, spokenCount: null, score: null })
      assert.isNull(Option.getOrThrow(yield* dictionary.entry(taberu)).frequency)
    })
  )

  it.effect("shows the dictionary's usage pattern beside Kotori's, and cautions with the word they name", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      yield* seed
      yield* db.insert(usagePatterns).values({
        entryId: gokurou,
        sense: 0,
        position: 1,
        text: "Upward it sounds condescending; say お疲れ様です.",
        source: "kotori",
        aboutEntryId: taberu
      })
      yield* db.insert(cautions).values([
        { entryId: kuu, sense: 0, rank: 2, kind: "confusable", text: "Not 喰う.", source: "kotori" },
        {
          entryId: kuu,
          sense: null,
          rank: 1,
          kind: "rude_upward",
          text: "Rough upward.",
          aboutEntryId: taberu,
          source: "kotori"
        }
      ])

      const kurou = Option.getOrThrow(yield* dictionary.entry(gokurou))
      assert.deepStrictEqual(kurou.senses[0]?.usagePatterns, [
        { text: "usu. to one's subordinate", source: "jmdict", about: null },
        {
          text: "Upward it sounds condescending; say お疲れ様です.",
          source: "kotori",
          about: { entryId: taberu, headword: "食べる", reading: "たべる" }
        }
      ])
      const shown = Option.getOrThrow(yield* dictionary.entry(kuu))
      assert.deepStrictEqual(
        shown.cautions.map((caution) => [caution.kind, caution.sense, caution.about?.headword ?? null]),
        [
          ["rude_upward", null, "食べる"],
          ["confusable", 0, null]
        ]
      )
    })
  )

  it.effect("reads the loan link from both ends", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      yield* seed
      const link = {
        katakana: "マンション",
        katakanaEntryId: mansion,
        english: "mansion",
        englishEntryId: mansionEn,
        meaning: null,
        source: "jmdict" as const,
        meaningSource: null
      }
      assert.deepStrictEqual(Option.getOrThrow(yield* dictionary.entry(mansion)).loanLink, link)
      assert.deepStrictEqual(Option.getOrThrow(yield* dictionary.entry(mansionEn)).loanLink, link)
      assert.isNull(Option.getOrThrow(yield* dictionary.entry(taberu)).loanLink)
    })
  )

  it.effect("derives similar words and how they differ from shared glosses and cross-references", () =>
    Effect.gen(function* () {
      const dictionary = yield* Dictionary
      yield* seed
      const shown = Option.getOrThrow(yield* dictionary.entry(taberu))
      assert.deepStrictEqual(
        shown.senses[0]?.similarWords.map((similar) => [
          similar.headword,
          similar.meaning,
          similar.difference,
          similar.via
        ]),
        [
          ["食う", "to eat", "masculine", "gloss"],
          ["召し上がる", "to eat; to drink", "respectful", "gloss"]
        ]
      )
      assert.deepStrictEqual(shown.senses[1]?.similarWords, [])

      // From 召し上がる, 食べる is the plain word; 食う, marked male, is the masculine one.
      const polite = Option.getOrThrow(yield* dictionary.entry(meshiagaru))
      assert.deepStrictEqual(
        polite.senses[0]?.similarWords.map((similar) => [similar.headword, similar.difference]),
        [
          ["食べる", "plain"],
          ["食う", "masculine"]
        ]
      )
      // From 食う, 食べる is the plain word.
      assert.deepStrictEqual(
        Option.getOrThrow(yield* dictionary.entry(kuu)).senses[0]?.similarWords.map((similar) => [
          similar.headword,
          similar.difference
        ]),
        [
          ["食べる", "plain"],
          ["召し上がる", "respectful"]
        ]
      )

      // "dine" is too rare to come in by a shared gloss, but eat's second sense lists it.
      const english = Option.getOrThrow(yield* dictionary.entry(eat))
      assert.deepStrictEqual(
        english.senses[1]?.similarWords.map((similar) => [
          similar.headword,
          similar.meaning,
          similar.difference,
          similar.via
        ]),
        [["dine", "食事をする、正餐を取る", "more_formal", "xref"]]
      )
    })
  )

  it.effect("follows a cross-reference to the word with the reading it names, among words spelled alike", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const jouzu = EntryId.make(1580940)
      const uwate = EntryId.make(1580960)
      const shitate = EntryId.make(1302260)
      yield* insertEntries(db, [
        { ...entry(jouzu, "上手", "じょうず", [sense(["skillful"], ["adj-na"])]), priority: 90 },
        { ...entry(uwate, "上手", "うわて", [sense(["upper hand"], ["n"])]), priority: 40 },
        entry(shitate, "下手", "したて", [{ ...sense(["inferiority"], ["n"]), xrefs: ["上手・うわて"] }])
      ])
      const shown = Option.getOrThrow(yield* dictionary.entry(shitate))
      assert.deepStrictEqual(shown.senses[0]?.related, [{ text: "上手（うわて）", entryId: uwate }])
      assert.deepStrictEqual(
        shown.senses[0]?.similarWords.map((similar) => [similar.entryId, similar.meaning]),
        [[uwate, "upper hand"]]
      )
    })
  )
})

layer(testLayer(true, true))("Dictionary with a finished job that saved nothing", (it) => {
  it.effect("reports examples as unavailable, not queued, then retries them hourly", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const id = EntryId.make(100000070)
      const hour = 60 * 60 * 1000
      const look = (at: number) =>
        TestClock.setTime(at).pipe(Effect.andThen(dictionary.requestEnrichment(id)), Effect.map(Option.getOrThrow))
      yield* insertEntries(db, [word(100000070, "gist", [sense(["要点"], ["n"])])])

      // The first look queues the examples.
      assert.strictEqual((yield* look(0)).examples, "queued")

      // The worker finishes without saving a row: every sentence filtered out.
      yield* finishJobs("examples", 1)

      // Nothing is on its way, so the app must stop polling.
      assert.strictEqual((yield* look(3000)).examples, "unavailable")
      assert.strictEqual((yield* jobStatusFor(db, id)).get("examples"), "done")

      // An hour on, a look gives it one more try.
      assert.strictEqual((yield* look(hour + 2000)).examples, "queued")
    })
  )
})

layer(testLayer(true))("Dictionary with Jev configured", (it) => {
  it.effect("counts seeded sentences in the audio status until they are judged and voiced", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const id = EntryId.make(30)
      const audioStatus = Effect.map(dictionary.requestEnrichment(id), (s) => Option.getOrThrow(s).audio)
      yield* insertEntries(db, [seededEntry(30, "雨", "あめ", "雨が降る。")], { seeded: true })
      yield* triedExamples(id)
      yield* saveAudio(db, clip("ame", "あめ", "ja"))
      yield* linkEntryAudio(db, id, "ame")

      // The headword is voiced, but the seeded sentence can be judged and voiced: audio is on its way.
      assert.strictEqual(yield* audioStatus, "queued")
      assert.strictEqual((yield* jobStatusFor(db, id)).get("audio"), "queued")

      // The worker judges it and voices it: the entry's audio is complete.
      const [seeded] = yield* examplesFor(db, [id])
      const casting = {
        speakerGender: "unspecified",
        speakerAge: "unspecified",
        medium: null,
        variety: null,
        tone: null
      } as const
      yield* saveCasting(db, [{ id: seeded!.id, formality: "neutral", casting }])
      yield* saveAudio(db, clip("ame-sentence", "雨が降る。", "ja"))
      yield* linkExampleAudio(db, seeded!.id, "ja", "ame-sentence")
      yield* finishJobs("audio", 1)
      assert.strictEqual(yield* audioStatus, "ready")
      assert.strictEqual((yield* jobStatusFor(db, id)).get("audio"), "done")
    })
  )
  it.effect("voices a seeded sentence only where Kotori wrote none, judging an untried one at most hourly", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const hour = 60 * 60 * 1000
      const status = (id: EntryId) => Effect.map(dictionary.requestEnrichment(id), (s) => Option.getOrThrow(s).audio)
      const audioJob = (id: EntryId) => Effect.map(jobStatusFor(db, id), (jobs) => jobs.get("audio"))

      // Voiced before seeded sentences were: its Tatoeba sentence was never judged. A look queues
      // the job for it, at most once an hour while it stays untried.
      const ame = EntryId.make(32)
      yield* insertEntries(db, [seededEntry(32, "雨", "あめ", "雨が降っている。")], { seeded: true })
      yield* triedExamples(ame)
      yield* saveAudio(db, clip("ame", "あめ", "ja"))
      yield* linkEntryAudio(db, ame, "ame")
      yield* enqueueJob(db, "audio", ame, 0, new Date(0))
      yield* finishJobs("audio", 1)
      yield* TestClock.setTime(2 * hour)
      assert.strictEqual(yield* status(ame), "queued")
      yield* finishJobs("audio", 2 * hour)
      yield* TestClock.setTime(2 * hour + 1000)
      assert.strictEqual(yield* audioJob(ame), "done")
      yield* status(ame)
      assert.strictEqual(yield* audioJob(ame), "done")
      yield* TestClock.setTime(3 * hour + 1)
      yield* status(ame)
      assert.strictEqual(yield* audioJob(ame), "queued")

      // Beside Kotori's voiced sentence on the same sense, the seeded one isn't waited for or queued.
      const kasa = EntryId.make(33)
      yield* insertEntries(db, [seededEntry(33, "傘", "かさ", "傘を忘れた。")], { seeded: true })
      yield* saveExamples(db, kasa, [example(0, "傘ある？", "Got an umbrella?")], new Date(1))
      yield* saveAudio(db, clip("kasa", "かさ", "ja"))
      yield* linkEntryAudio(db, kasa, "kasa")
      const kotori = (yield* examplesFor(db, [kasa])).find((row) => row.source === "kotori")!
      yield* saveAudio(db, clip("kasa-sentence", kotori.ja, "ja"))
      yield* linkExampleAudio(db, kotori.id, "ja", "kasa-sentence")
      yield* enqueueJob(db, "audio", kasa, 0, new Date(0))
      yield* finishJobs("audio", 2)
      yield* TestClock.setTime(10 * hour)
      assert.strictEqual(yield* status(kasa), "ready")
      assert.strictEqual(yield* audioJob(kasa), "done")

      // Looking queued other jobs for these words; they aren't the other tests' to run.
      yield* db.delete(jobs).where(inArray(jobs.entryId, [ame, kasa]))
    })
  )

  it.effect("doesn't ask about a seeded sentence Jev judged and declined again, and settles its audio", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const hour = 60 * 60 * 1000
      const id = EntryId.make(34)
      const status = Effect.map(dictionary.requestEnrichment(id), (s) => Option.getOrThrow(s).audio)
      yield* insertEntries(db, [seededEntry(34, "窓", "まど", "窓を閉める。")], { seeded: true })
      yield* triedExamples(id)
      yield* saveAudio(db, clip("mado", "まど", "ja"))
      yield* linkEntryAudio(db, id, "mado")
      yield* TestClock.setTime(1)
      assert.strictEqual(yield* status, "queued")

      // The audio job asks Jev, which gives no formality: the sentence is judged and declined.
      const [seeded] = yield* examplesFor(db, [id])
      yield* declineCasting(db, [seeded!.id])
      yield* finishJobs("audio", 2)

      // Nothing is left that a run could voice: the audio is complete, and hours on, no look queues it again.
      for (const at of [3, 2 * hour, 30 * hour]) {
        yield* TestClock.setTime(at)
        assert.strictEqual(yield* status, "ready")
        assert.strictEqual((yield* jobStatusFor(db, id)).get("audio"), "done")
      }
      yield* db.delete(jobs).where(inArray(jobs.entryId, [id]))
    })
  )

  it.effect("serves no clip for a seeded sentence once Kotori's sentences are beside it", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const id = EntryId.make(35)
      yield* insertEntries(db, [seededEntry(35, "傘", "かさ", "傘を忘れた。")], { seeded: true })
      yield* saveAudio(db, clip("kasa", "かさ", "ja"))
      yield* linkEntryAudio(db, id, "kasa")

      // Claude is down on the first look: no examples job is queued. Kotori's sentences may still
      // come, so the seeded one isn't waited for: the voiced headword is the entry's audio.
      yield* TestClock.setTime(1)
      const first = Option.getOrThrow(yield* dictionary.requestEnrichment(id))
      assert.deepStrictEqual(first, { examples: "unavailable", audio: "ready" })
      assert.isFalse((yield* jobStatusFor(db, id)).has("examples"))

      // The seeded sentence was voiced while it was the sense's only example (before this rule, or
      // after an examples job that wrote nothing), then Kotori's sentences came for the same sense.
      const [seeded] = yield* examplesFor(db, [id])
      yield* saveAudio(db, clip("kasa-seeded", seeded!.ja, "ja"))
      yield* linkExampleAudio(db, seeded!.id, "ja", "kasa-seeded")
      yield* saveExamples(db, id, [example(0, "傘ある？", "Got an umbrella?")], new Date(2))
      const kotori = (yield* examplesFor(db, [id])).find((row) => row.source === "kotori")!
      yield* saveAudio(db, clip("kasa-kotori", kotori.ja, "ja"))
      yield* linkExampleAudio(db, kotori.id, "ja", "kasa-kotori")

      // Beside Kotori's, the seeded sentence is shown but not read aloud.
      const shown = Option.getOrThrow(yield* dictionary.entry(id))
      assert.deepStrictEqual(
        shown.senses[0]?.examples.map((one) => [one.ja, one.source, one.audioUrl]),
        [
          ["傘ある？", "kotori", "/audio/kasa-kotori.mp3"],
          ["傘を忘れた。", "tatoeba", null]
        ]
      )
      yield* db.delete(jobs).where(inArray(jobs.entryId, [id]))
    })
  )
})

layer(testLayer(true, true))("Dictionary with Jev and Claude", (it) => {
  it.effect("queues examples and audio for a viewed word, and no other job", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const dictionary = yield* Dictionary
      const id = EntryId.make(40)
      yield* insertEntries(db, [entry(40, "雨", "あめ", [sense(["rain"], ["n"])])])
      const status = Option.getOrThrow(yield* dictionary.requestEnrichment(id))
      assert.deepStrictEqual(status, { examples: "queued", audio: "queued" })
      assert.deepStrictEqual([...(yield* jobStatusFor(db, id)).keys()].toSorted(), ["audio", "examples"])
    })
  )
})
