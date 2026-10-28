import { assert, layer } from "@effect/vitest"
import { DictionaryRepo, EnrichmentRepo, Repositories, type EntryRecord } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Jev } from "@kotori/nuance"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  AudioStore,
  ElevenLabs,
  ENGLISH_CAST,
  isAudioKey,
  JAPANESE_CAST,
  Pronouncer,
  VoiceCasts
} from "../src/index.ts"

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

/** Jev always votes for the casual young woman, so tiebreaks are visible in the result. */
const votes: Array<unknown> = []
const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state, questions) =>
      Effect.sync(() => {
        votes.push(state)
        const criteria = Object.keys((Object.values(questions)[0] as { criteria: object }).criteria)
        const choice = criteria.find((id) => id.includes("casual-f") && !id.includes("f2")) ?? criteria[0]!
        return {
          model: "jev-test",
          answers: { voice: { type: "choice", choice, confidence: 0.9, probabilities: {} } },
          usage: { input_tokens: 10, output_tokens: 0 }
        } as never
      })
  })
)

/** The real casts with every voice given a provider id, so casting has a full lineup. */
const FullCasts = Layer.succeed(VoiceCasts, {
  ja: JAPANESE_CAST.map((voice) => ({ ...voice, providerId: voice.providerId ?? `fake-${voice.id}` })),
  en: ENGLISH_CAST.map((voice) => ({ ...voice, providerId: voice.providerId ?? `fake-${voice.id}` }))
})

const TestLayer = Pronouncer.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Repositories, FakeElevenLabs, AudioStore.layer, FakeJev, FullCasts)),
  Layer.provideMerge(DatabaseMemory),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        KOTORI_AUDIO_MONTHLY_CHARS: "5000",
        KOTORI_AUDIO_LANGUAGES: "ja,en",
        KOTORI_HEADWORD_VOICES: "2"
      })
    )
  )
)

const entry = (id: number, senses: Array<{ dialects?: Array<string>; misc?: Array<string> }>): EntryRecord => ({
  id,
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
    antonyms: []
  }))
})

const example = {
  furigana: "x",
  note: null,
  model: "m",
  speakerGender: null,
  speakerAge: null,
  medium: null,
  variety: null,
  tone: null
}

const voiceOf = (text: string) => calls.filter((call) => call.text === text).map((call) => call.voiceId)

layer(TestLayer)("Pronouncer", (it) => {
  it.effect("speaks with the default dictionary voice and caches per voice", () =>
    Effect.gen(function* () {
      calls.length = 0
      const pronouncer = yield* Pronouncer
      const key = yield* pronouncer.speak("たべる", "ja")
      assert.isTrue(isAudioKey(key))
      assert.strictEqual(yield* pronouncer.speak(" たべる ", "ja"), key)
      assert.deepStrictEqual(calls, [{ text: "たべる", voiceId: "4lOQ7A2l7HPuG7UIHiKA" }])

      // Another voice speaking the same text is a new clip, not a cache hit.
      const elder = JAPANESE_CAST.find((voice) => voice.id === "ja-elder-m")!
      const second = yield* pronouncer.speak("たべる", "ja", { ...elder, providerId: "fake-ja-elder-m" })
      assert.notStrictEqual(second, key)
      assert.strictEqual(voiceOf("たべる")[1], "fake-ja-elder-m")
    })
  )

  it.effect("voices the headword once per dictionary voice, capped by KOTORI_HEADWORD_VOICES", () =>
    Effect.gen(function* () {
      calls.length = 0
      yield* (yield* DictionaryRepo).insertEntries([entry(1, [{}])])
      const summary = yield* (yield* Pronouncer).enrichEntry(1)
      assert.strictEqual(summary.clips, 2)
      // Kyoko (already cached from the test above) and the announcer, the first two headword voices.
      assert.deepStrictEqual(voiceOf("たべる"), ["fake-ja-announcer"])
      const clips = (yield* (yield* EnrichmentRepo).entryAudio([1])).get(1) ?? []
      assert.deepStrictEqual(
        clips.map((clip) => clip.voice).toSorted((a, b) => String(a).localeCompare(String(b))),
        ["ja-announcer", "ja-kyoko"]
      )
    })
  )

  it.effect("casts one speaker across both languages of an example", () =>
    Effect.gen(function* () {
      calls.length = 0
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      yield* dictionary.insertEntries([entry(2, [{}])])
      yield* enrichment.saveExamples(
        2,
        [
          {
            ...example,
            sense: 0,
            ja: "ニュースをお伝えします。",
            en: "Here is the news.",
            formality: "formal" as const,
            medium: "announcement" as const
          }
        ],
        1000
      )
      yield* (yield* Pronouncer).enrichEntry(2)
      // The announcer is the lone formal-announcement candidate in both casts: no Jev call.
      assert.deepStrictEqual(voiceOf("ニュースをお伝えします。"), ["fake-ja-announcer"])
      assert.deepStrictEqual(voiceOf("Here is the news."), ["fake-en-announcer"])
      const [row] = yield* enrichment.examplesFor([2])
      const linked = yield* enrichment.exampleAudio([row!.id])
      assert.strictEqual(linked.size, 2)
    })
  )

  it.effect("sends ties to Jev and records the casting", () =>
    Effect.gen(function* () {
      calls.length = 0
      votes.length = 0
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      yield* dictionary.insertEntries([entry(3, [{}])])
      // Casual with no gender signal: the young casual voices tie, Jev votes casual-f.
      yield* enrichment.saveExamples(
        3,
        [{ ...example, sense: 0, ja: "まじやばい。", en: "That's crazy.", formality: "casual" as const }],
        1000
      )
      yield* (yield* Pronouncer).enrichEntry(3)
      assert.isAbove(votes.length, 0)
      assert.deepStrictEqual(voiceOf("まじやばい。"), ["fake-ja-casual-f"])
    })
  )

  it.effect("falls back to standard voices when the sentence's variety has no cast voice", () =>
    Effect.gen(function* () {
      calls.length = 0
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      yield* dictionary.insertEntries([entry(4, [{ dialects: ["thb"] }])])
      // Tohoku is a known variety, but nobody in the cast speaks it.
      yield* enrichment.saveExamples(
        4,
        [
          {
            ...example,
            sense: 0,
            ja: "んだんだ。",
            en: "That's right.",
            formality: "casual" as const,
            variety: "tohoku"
          }
        ],
        1000
      )
      yield* (yield* Pronouncer).enrichEntry(4)
      assert.strictEqual(voiceOf("んだんだ。").length, 1)
      assert.isTrue(voiceOf("んだんだ。")[0]!.startsWith("fake-ja-casual"))
    })
  )

  it.effect("refuses to exceed the monthly character budget", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Pronouncer).speak("あ".repeat(6000), "ja").pipe(Effect.flip)
      assert.strictEqual(error.reason, "quota")
    })
  )
})
