import { assert, layer } from "@effect/vitest"
import { ElevenLabs, ENGLISH_CAST, JAPANESE_CAST, Jev, JevError, Pronouncer, VoiceCasts } from "@kotori/ai"
import { type Casting, EntryId, type EntryRecord } from "@kotori/contracts"
import { labels } from "@kotori/db"
import { ConfigProvider, Effect, Layer } from "effect"
import { Database } from "../src/db/Database.ts"
import { AudioStore, isAudioKey } from "../src/features/audio/AudioStore.ts"
import { entryClips, exampleClips, linkEntryAudio, linkExampleAudio, saveAudio } from "../src/features/audio/queries.ts"
import { Speech } from "../src/features/audio/Speech.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { AudioEnricher } from "../src/features/enrichment/AudioEnricher.ts"
import { examplesFor, saveExamples } from "../src/features/enrichment/queries.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

const calls: Array<{ text: string; voiceId: string }> = []

const FakeElevenLabs = Layer.succeed(
  ElevenLabs,
  ElevenLabs.of({
    configured: true,
    model: "test-model",
    synthesize: (text, _language, voiceId) =>
      Effect.sync(() => {
        calls.push({ text, voiceId })
        return new TextEncoder().encode(`mp3:${text}`)
      })
  })
)

/**
 * Jev always votes for the casual young woman, so tiebreaks are visible in the result. Asked to
 * judge seeded sentences, it calls each one formal, from an older man, as an announcement, or
 * fails when `jevFails` is set.
 */
const votes: Array<unknown> = []
const judgments: Array<ReadonlyArray<string>> = []
let jevFails = false
const sure = (choice: string) => ({ type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } })
const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state, questions) => {
      if (Object.keys(questions).some((name) => name.endsWith("_formality"))) {
        if (jevFails) return Effect.fail(new JevError({ message: "Jev is down" }))
        return Effect.sync(() => {
          judgments.push(
            Object.entries(questions)
              .filter(([name]) => name.endsWith("_formality"))
              .map(([, question]) => (question.instructions as { sentence: string }).sentence)
          )
          const answers = Object.fromEntries(
            Object.keys(questions).map((name) => {
              const kind = name.slice(name.indexOf("_") + 1)
              const answer =
                kind === "formality"
                  ? { type: "score", score: 4, confidence: 0.9, legend: {}, probabilities: { "4": 0.9, "3": 0.1 } }
                  : sure({ gender: "masculine", age: "older", medium: "announcement", tone: "serious" }[kind]!)
              return [name, answer]
            })
          )
          return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 0 } } as never
        })
      }
      return Effect.sync(() => {
        votes.push(state)
        const criteria = Object.keys((Object.values(questions)[0] as { criteria: object }).criteria)
        const choice = criteria.find((id) => id.includes("casual-f") && !id.includes("f2")) ?? criteria[0]!
        return {
          model: "jev-test",
          answers: { voice: { type: "choice", choice, confidence: 0.9, probabilities: {} } },
          usage: { input_tokens: 10, output_tokens: 0 }
        } as never
      })
    }
  })
)

/** The real casts with fake provider ids, so tests don't depend on which voices are cast. */
const FullCasts = Layer.succeed(VoiceCasts, {
  ja: JAPANESE_CAST.map((voice) => ({ ...voice, providerId: `fake-${voice.id}` })),
  en: ENGLISH_CAST.map((voice) => ({ ...voice, providerId: `fake-${voice.id}` }))
})

const testLayer = (jev: Layer.Layer<Jev>) =>
  AudioEnricher.layer.pipe(
    Layer.provideMerge(Speech.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        AudioStore.database,
        Pronouncer.layer.pipe(Layer.provide(Layer.mergeAll(FakeElevenLabs, jev, FullCasts)))
      )
    ),
    Layer.provideMerge(DatabaseMemory),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          KOTORI_AUDIO_MONTHLY_CHARS: "5000",
          KOTORI_HEADWORD_VOICES: "2"
        })
      )
    )
  )

const entry = (id: number, senses: Array<{ dialects?: Array<string>; misc?: Array<string> }>): EntryRecord => ({
  id: EntryId.make(id),
  language: "ja",
  dictionary: "jmdict",
  headword: "食べる",
  reading: "たべる",
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: "食べる", common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: "たべる", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: senses.map((sense) => ({
    glosses: [{ text: "to eat", type: null }],
    pos: ["v1"],
    misc: sense.misc ?? [],
    fields: [],
    dialects: sense.dialects ?? [],
    info: [],
    stagk: [],
    stagr: [],
    xrefs: [],
    antonyms: [],
    sources: [],
    wasei: false
  }))
})

const example = { furigana: "x", note: null, model: "m" }

const casting = (signals: Partial<Casting>): Casting => ({
  speakerGender: "unspecified",
  speakerAge: "unspecified",
  medium: null,
  variety: null,
  tone: null,
  ...signals
})

/** The entry with Tatoeba sentences on its first sense, as the seed import gives them. */
const withSeeded = (record: EntryRecord, sentences: ReadonlyArray<string>) => ({
  ...record,
  senses: record.senses.map((sense, index) =>
    index === 0
      ? { ...sense, examples: sentences.map((ja) => ({ ja, en: `(${ja})`, source: "tatoeba" as const })) }
      : sense
  )
})

const voiceOf = (text: string) => calls.filter((call) => call.text === text).map((call) => call.voiceId)

layer(testLayer(FakeJev))("Speech and AudioEnricher", (it) => {
  it.effect("speaks with the default dictionary voice and caches per voice", () =>
    Effect.gen(function* () {
      calls.length = 0
      const speech = yield* Speech
      const key = yield* speech.speak("たべる", "ja")
      assert.isTrue(isAudioKey(key))
      assert.strictEqual(yield* speech.speak(" たべる ", "ja"), key)
      assert.deepStrictEqual(calls, [{ text: "たべる", voiceId: "fake-ja-kyoko" }])

      // Another voice speaking the same text is a new clip, not a cache hit.
      const elder = JAPANESE_CAST.find((voice) => voice.id === "ja-elder-m")!
      const second = yield* speech.speak("たべる", "ja", { ...elder, providerId: "fake-ja-elder-m" })
      assert.notStrictEqual(second, key)
      assert.strictEqual(voiceOf("たべる")[1], "fake-ja-elder-m")
    })
  )

  it.effect("voices the headword once per dictionary voice, capped by KOTORI_HEADWORD_VOICES", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      yield* insertEntries(db, [entry(1, [{}])])
      const summary = yield* (yield* AudioEnricher).enrich(EntryId.make(1))
      assert.strictEqual(summary.clips, 2)
      // Kyoko (already cached from the test above) and the announcer, the first two headword voices.
      assert.deepStrictEqual(voiceOf("たべる"), ["fake-ja-announcer"])
      const clips = (yield* entryClips(db, [EntryId.make(1)])).get(EntryId.make(1)) ?? []
      assert.deepStrictEqual(
        clips.map((clip) => clip.voice).toSorted((a, b) => String(a).localeCompare(String(b))),
        ["ja-announcer", "ja-kyoko"]
      )
    })
  )

  it.effect("voices a Japanese word's sentences in Japanese only", () =>
    Effect.gen(function* () {
      calls.length = 0
      const db = yield* Database
      yield* insertEntries(db, [entry(2, [{}])])
      yield* saveExamples(
        db,
        EntryId.make(2),
        [
          {
            ...example,
            sense: 0,
            ja: "ニュースをお伝えします。",
            en: "Here is the news.",
            formality: "formal" as const,
            casting: casting({ medium: "announcement" })
          }
        ],
        new Date(1000)
      )
      yield* (yield* AudioEnricher).enrich(EntryId.make(2))
      // The announcer is the lone formal-announcement candidate: no Jev call.
      assert.deepStrictEqual(voiceOf("ニュースをお伝えします。"), ["fake-ja-announcer"])
      // English speakers learning the word don't need the translation read to them.
      assert.deepStrictEqual(voiceOf("Here is the news."), [])
      const [row] = yield* examplesFor(db, [EntryId.make(2)])
      assert.deepStrictEqual([...(yield* exampleClips(db, [row!.id])).keys()], [`${row!.id}:ja`])
    })
  )

  it.effect("voices an English word and its sentences in English, the headword as written", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      yield* insertEntries(db, [
        {
          ...entry(100000001, [{ dialects: ["en-GB"] }]),
          language: "en",
          headword: "flat",
          reading: "/flæt/",
          forms: [
            { kind: "spelling", text: "flat", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
          ]
        }
      ])
      yield* saveExamples(
        db,
        EntryId.make(100000001),
        [
          {
            ...example,
            sense: 0,
            ja: "新しいフラットに引っ越した。",
            en: "We've moved into a new flat.",
            formality: "neutral" as const
          }
        ],
        new Date(1000)
      )
      const summary = yield* (yield* AudioEnricher).enrich(EntryId.make(100000001))
      // Two English headword voices read "flat", never its IPA; the sentence goes to the British voice.
      assert.strictEqual(voiceOf("flat").length, 2)
      assert.isTrue(voiceOf("flat").every((voice) => voice.startsWith("fake-en-")))
      assert.deepStrictEqual(voiceOf("/flæt/"), [])
      assert.deepStrictEqual(voiceOf("We've moved into a new flat."), ["fake-en-british-m"])
      assert.deepStrictEqual(voiceOf("新しいフラットに引っ越した。"), [])
      assert.strictEqual(summary.clips, 3)
    })
  )

  it.effect("sends ties to Jev and records the casting", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      votes.length = 0
      yield* insertEntries(db, [entry(3, [{}])])
      // Casual with no gender signal: the young casual voices tie, Jev votes casual-f.
      yield* saveExamples(
        db,
        EntryId.make(3),
        [{ ...example, sense: 0, ja: "まじやばい。", en: "That's crazy.", formality: "casual" as const }],
        new Date(1000)
      )
      yield* (yield* AudioEnricher).enrich(EntryId.make(3))
      assert.isAbove(votes.length, 0)
      assert.deepStrictEqual(voiceOf("まじやばい。"), ["fake-ja-casual-f"])
    })
  )

  it.effect("falls back to standard voices when the sentence's variety has no cast voice", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      yield* insertEntries(db, [entry(4, [{ dialects: ["thb"] }])])
      // Tohoku is a known variety, but nobody in the cast speaks it.
      yield* saveExamples(
        db,
        EntryId.make(4),
        [
          {
            ...example,
            sense: 0,
            ja: "んだんだ。",
            en: "That's right.",
            formality: "casual" as const,
            casting: casting({ variety: "tohoku" })
          }
        ],
        new Date(1000)
      )
      yield* (yield* AudioEnricher).enrich(EntryId.make(4))
      assert.strictEqual(voiceOf("んだんだ。").length, 1)
      assert.isTrue(voiceOf("んだんだ。")[0]!.startsWith("fake-ja-casual"))
    })
  )

  it.effect("voices only what is missing, leaving earlier clips and their voices alone", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [entry(5, [{}])])
      yield* saveExamples(
        db,
        EntryId.make(5),
        [
          { ...example, sense: 0, ja: "めっちゃうまい。", en: "This is so good.", formality: "casual" as const },
          { ...example, sense: 0, ja: "もう食べた？", en: "Have you eaten yet?", formality: "casual" as const }
        ],
        new Date(1000)
      )
      const [first] = yield* examplesFor(db, [EntryId.make(5)])
      // Voiced before casting: one uncast headword clip, and the first sentence.
      const old = (key: string, text: string) => ({
        key,
        text,
        language: "ja" as const,
        voiceId: "kyoko-before-casting",
        voice: null,
        modelId: "old-model",
        characters: text.length,
        bytes: 1,
        createdAt: new Date(0)
      })
      yield* saveAudio(db, old("old-headword", "たべる"))
      yield* saveAudio(db, old("old-sentence", "めっちゃうまい。"))
      yield* linkEntryAudio(db, EntryId.make(5), "old-headword")
      yield* linkExampleAudio(db, first!.id, "ja", "old-sentence")

      calls.length = 0
      const audio = yield* AudioEnricher
      const summary = yield* audio.enrich(EntryId.make(5))
      assert.deepStrictEqual(
        calls.map((call) => call.text),
        ["もう食べた？"]
      )
      assert.strictEqual(summary.clips, 1)
      const linked = yield* exampleClips(db, [first!.id])
      assert.strictEqual(linked.get(`${first!.id}:ja`), "old-sentence")
      assert.deepStrictEqual(
        ((yield* entryClips(db, [EntryId.make(5)])).get(EntryId.make(5)) ?? []).map((clip) => clip.key),
        ["old-headword"]
      )

      // Nothing left to voice: no synthesis and no Jev tiebreak.
      calls.length = 0
      votes.length = 0
      assert.deepStrictEqual(yield* audio.enrich(EntryId.make(5)), { clips: 0, characters: 0, judged: 0 })
      assert.strictEqual(calls.length, 0)
      assert.strictEqual(votes.length, 0)
    })
  )

  it.effect("judges an entry's seeded sentences in one Jev request, then voices them", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      judgments.length = 0
      yield* insertEntries(db, [withSeeded(entry(6, [{}]), ["お茶をどうぞ。", "粗茶ですが。"])], { seeded: true })
      // Kotori's sentence came with its register: Jev isn't asked about it.
      yield* saveExamples(
        db,
        EntryId.make(6),
        [{ ...example, sense: 0, ja: "お茶飲む？", en: "Want some tea?", formality: "casual" as const }],
        new Date(1000)
      )

      const summary = yield* (yield* AudioEnricher).enrich(EntryId.make(6))
      assert.deepStrictEqual(judgments, [["お茶をどうぞ。", "粗茶ですが。"]])
      assert.strictEqual(summary.judged, 2)
      const stored = yield* examplesFor(db, [EntryId.make(6)])
      assert.deepStrictEqual(
        stored.map((row) => [row.ja, row.source, row.formality, row.casting?.speakerAge ?? null]),
        [
          ["お茶飲む？", "kotori", "casual", null],
          ["お茶をどうぞ。", "tatoeba", "formal", "older"],
          ["粗茶ですが。", "tatoeba", "formal", "older"]
        ]
      )
      assert.deepStrictEqual(stored[1]?.casting, {
        speakerGender: "masculine",
        speakerAge: "older",
        medium: "announcement",
        variety: null,
        tone: "serious"
      })
      // Every sentence is voiced in Japanese, the seeded ones as the formal announcement they were judged.
      for (const text of ["お茶飲む？", "お茶をどうぞ。", "粗茶ですが。"]) assert.strictEqual(voiceOf(text).length, 1)
      assert.deepStrictEqual(voiceOf("お茶をどうぞ。"), ["fake-ja-announcer"])

      // Judged once: running again asks Jev nothing and voices nothing.
      calls.length = 0
      yield* (yield* AudioEnricher).enrich(EntryId.make(6))
      assert.strictEqual(judgments.length, 1)
      assert.strictEqual(calls.length, 0)
    })
  )

  it.effect("casts by the sentence's own sense's labels, Kotori's included, not the word's", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      // Only the second sense is a man's word: the word as a whole carries no such label.
      yield* insertEntries(db, [entry(7, [{}, {}])])
      yield* db.insert(labels).values({ entryId: EntryId.make(7), sense: 1, code: "male", source: "kotori" })
      yield* saveExamples(
        db,
        EntryId.make(7),
        [
          { ...example, sense: 0, ja: "うまい。", en: "Tasty.", formality: "casual" as const },
          { ...example, sense: 1, ja: "食うぞ。", en: "I'm gonna eat.", formality: "casual" as const }
        ],
        new Date(1000)
      )
      yield* (yield* AudioEnricher).enrich(EntryId.make(7))
      // Unmarked, the young casual voices tie and Jev picks the woman; the man's word goes to a man.
      assert.deepStrictEqual(voiceOf("うまい。"), ["fake-ja-casual-f"])
      const [man] = voiceOf("食うぞ。")
      assert.strictEqual(JAPANESE_CAST.find((voice) => `fake-${voice.id}` === man)?.tags.gender, "masculine")
    })
  )

  it.effect("voices the rest when Jev fails, leaves seeded sentences unjudged and unvoiced, and fails", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      judgments.length = 0
      yield* insertEntries(db, [withSeeded(entry(8, [{}]), ["雨が降る。"])], { seeded: true })
      yield* saveExamples(
        db,
        EntryId.make(8),
        [{ ...example, sense: 0, ja: "雨やばい。", en: "This rain is crazy.", formality: "casual" as const }],
        new Date(1000)
      )

      jevFails = true
      const error = yield* (yield* AudioEnricher).enrich(EntryId.make(8)).pipe(Effect.flip)
      jevFails = false
      assert.strictEqual(error._tag, "JevError")
      assert.strictEqual(voiceOf("雨やばい。").length, 1)
      assert.deepStrictEqual(voiceOf("雨が降る。"), [])
      const seeded = (yield* examplesFor(db, [EntryId.make(8)])).find((row) => row.source === "tatoeba")
      assert.strictEqual(seeded?.formality, null)
      assert.strictEqual(seeded?.casting, null)

      // The retry judges it and voices it.
      yield* (yield* AudioEnricher).enrich(EntryId.make(8))
      assert.strictEqual(voiceOf("雨が降る。").length, 1)
    })
  )

  it.effect("refuses to exceed the monthly character budget", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Speech).speak("あ".repeat(6000), "ja").pipe(Effect.flip)
      assert.strictEqual(error.reason, "quota")
    })
  )
})

layer(testLayer(Layer.succeed(Jev, Jev.of({ configured: false, model: "jev-test", ask: () => Effect.die("unused") }))))(
  "AudioEnricher without Jev",
  (it) => {
    it.effect("never voices a seeded sentence: no register is assumed", () =>
      Effect.gen(function* () {
        const db = yield* Database
        calls.length = 0
        yield* insertEntries(db, [withSeeded(entry(9, [{}]), ["猫がいる。"])], { seeded: true })
        const summary = yield* (yield* AudioEnricher).enrich(EntryId.make(9))
        assert.strictEqual(summary.judged, 0)
        assert.deepStrictEqual(voiceOf("猫がいる。"), [])
        assert.strictEqual((yield* examplesFor(db, [EntryId.make(9)]))[0]?.formality, null)
      })
    )
  }
)
