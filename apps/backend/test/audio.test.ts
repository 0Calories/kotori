import { assert, layer } from "@effect/vitest"
import { ElevenLabs, ENGLISH_CAST, JAPANESE_CAST, Jev, Pronouncer, VoiceCasts } from "@kotori/ai"
import { EntryId, type EntryRecord } from "@kotori/contracts"
import { ConfigProvider, Effect, Layer } from "effect"
import { Database } from "../src/db/Database.ts"
import { AudioStore, isAudioKey } from "../src/features/audio/AudioStore.ts"
import { formClips, saveAudio } from "../src/features/audio/queries.ts"
import { Speech } from "../src/features/audio/Speech.ts"
import { deleteEntries, insertEntries } from "../src/features/dictionary/queries.ts"
import { AudioEnricher } from "../src/features/enrichment/AudioEnricher.ts"
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

const UnusedJev = Layer.succeed(Jev, Jev.of({ configured: false, model: "jev-test", ask: () => Effect.die("unused") }))

/** The real casts with fake provider ids, so tests don't depend on which voices are cast. */
const FullCasts = Layer.succeed(VoiceCasts, {
  ja: JAPANESE_CAST.map((voice) => ({ ...voice, providerId: `fake-${voice.id}` })),
  en: ENGLISH_CAST.map((voice) => ({ ...voice, providerId: `fake-${voice.id}` }))
})

const TestLayer = AudioEnricher.layer.pipe(
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      AudioStore.database,
      Pronouncer.layer.pipe(Layer.provide(Layer.mergeAll(FakeElevenLabs, UnusedJev, FullCasts)))
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

const entry = (id: number, headword = "食べる", reading = "たべる"): EntryRecord => ({
  id: EntryId.make(id),
  language: "ja",
  source: "jmdict",
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
  ],
  senses: [
    {
      glosses: [{ text: "to eat", type: null }],
      pos: ["v1"],
      misc: [],
      fields: [],
      dialects: [],
      info: [],
      stagk: [],
      stagr: [],
      xrefs: [],
      antonyms: [],
      origins: [],
      wasei: false
    }
  ]
})

const voiceOf = (text: string) => calls.filter((call) => call.text === text).map((call) => call.voiceId)

layer(TestLayer)("Speech and AudioEnricher", (it) => {
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
      const taberu = entry(1)
      yield* insertEntries(db, [taberu])
      const summary = yield* (yield* AudioEnricher).enrich(taberu.id)
      assert.strictEqual(summary.clips, 1)
      // Kyoko was already cached above, so only the announcer is synthesised.
      assert.deepStrictEqual(voiceOf("たべる"), ["fake-ja-announcer"])
      const clips = (yield* formClips(db, [taberu])).get(taberu.id) ?? []
      assert.deepStrictEqual(
        clips.map((clip) => clip.voice),
        ["ja-kyoko", "ja-announcer", "ja-elder-m"]
      )
    })
  )

  it.effect("preserves spoken form clips across entry rebuilds and identifier changes without a join table", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const original = entry(1)
      const before = (yield* formClips(db, [original])).get(original.id) ?? []
      assert.isAbove(before.length, 0)

      // Delete the entry and re-insert it under a completely different EntryId.
      yield* deleteEntries(db, [original.id])
      const rebuilt = entry(999999)
      yield* insertEntries(db, [rebuilt])

      const after = (yield* formClips(db, [rebuilt])).get(rebuilt.id) ?? []
      assert.deepStrictEqual(after, before)
    })
  )

  it.effect("voices an English word by headword (never IPA) and ignores non-headword voices in formClips", () =>
    Effect.gen(function* () {
      const db = yield* Database
      calls.length = 0
      const flat: EntryRecord = {
        ...entry(100000001, "flat", "/flæt/"),
        language: "en",
        forms: [
          { kind: "spelling", text: "flat", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
        ]
      }
      yield* insertEntries(db, [flat])
      // A non-headword voice clip for the same word must not show up as a dictionary headword pronunciation.
      yield* saveAudio(db, {
        key: "non-headword-clip",
        text: "flat",
        language: "en",
        voiceId: "fake-en-casual-f",
        voice: "en-casual-f",
        modelId: "test-model",
        characters: 4,
        bytes: 1,
        createdAt: new Date(0)
      })

      const summary = yield* (yield* AudioEnricher).enrich(flat.id)
      assert.strictEqual(voiceOf("flat").length, 2)
      assert.isTrue(voiceOf("flat").every((voice) => voice.startsWith("fake-en-")))
      assert.deepStrictEqual(voiceOf("/flæt/"), [])
      assert.strictEqual(summary.clips, 2)

      const clips = (yield* formClips(db, [flat])).get(flat.id) ?? []
      assert.isFalse(clips.some((clip) => clip.voice === "en-casual-f"))
      assert.strictEqual(clips.length, 2)
    })
  )

  it.effect("leaves legacy uncast headword clips alone without re-synthesising", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const nomu = entry(5, "飲む", "のむ")
      yield* insertEntries(db, [nomu])
      yield* saveAudio(db, {
        key: "old-headword",
        text: "のむ",
        language: "ja",
        voiceId: "kyoko-before-casting",
        voice: null,
        modelId: "old-model",
        characters: 2,
        bytes: 1,
        createdAt: new Date(0)
      })

      calls.length = 0
      const audio = yield* AudioEnricher
      assert.deepStrictEqual(yield* audio.enrich(nomu.id), { clips: 0, characters: 0 })
      assert.strictEqual(calls.length, 0)
      assert.deepStrictEqual(
        ((yield* formClips(db, [nomu])).get(nomu.id) ?? []).map((clip) => clip.key),
        ["old-headword"]
      )
    })
  )

  it.effect("refuses to exceed the monthly character budget", () =>
    Effect.gen(function* () {
      const error = yield* (yield* Speech).speak("あ".repeat(6000), "ja").pipe(Effect.flip)
      assert.strictEqual(error.reason, "quota")
    })
  )
})
