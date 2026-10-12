import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError } from "@kotori/ai"
import { DatabaseMemory, DictionaryRepo, type EntryRecord } from "@kotori/db"
import { Authorization, KotoriApi } from "@kotori/domain"
import { Jev, JevError } from "@kotori/nuance"
import { Pronouncer, TtsError } from "@kotori/tts"
import { Effect, Layer } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"
import { makeApp } from "../src/layers.ts"

// No AI providers are configured in tests: the app must degrade gracefully.
const OfflineProviders = Layer.mergeAll(
  Layer.succeed(Claude, Claude.of({
    model: "test",
    available: Effect.succeed(false),
    generate: () => Effect.fail(new ClaudeError({ reason: "unconfigured", message: "not configured" }))
  })),
  Layer.succeed(Jev, Jev.of({
    configured: false,
    model: "test",
    ask: () => Effect.fail(new JevError({ message: "not configured" }))
  })),
  Layer.succeed(Pronouncer, Pronouncer.of({
    configured: false,
    speak: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not configured" })),
    enrichEntry: () => Effect.succeed({ clips: 0, characters: 0 })
  }))
)

const App = makeApp(OfflineProviders, DatabaseMemory)
const Handlers = AllHandlers.pipe(Layer.provideMerge(AuthorizationLive), Layer.provideMerge(App))
const TestLayer = Layer.mergeAll(Handlers, HttpServer.layerServices, NodeServices.layer)

let token: string | null = null
const Auth = HttpApiMiddleware.layerClient(
  Authorization,
  ({ next, request }) => next(token === null ? request : HttpClientRequest.bearerToken(request, token))
)

const client = HttpApiTest.groups(KotoriApi, ["system", "account", "dictionary", "coach", "study", "audio"])

const sense = (glosses: Array<string>, pos: Array<string>) => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos,
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: []
})

const entry = (id: number, headword: string, reading: string, glosses: Array<string>, pos: Array<string>): EntryRecord => ({
  id,
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: ["ichi1"], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: ["ichi1"], restrictions: [], noKanji: false }
  ],
  senses: [sense(glosses, pos)]
})

layer(TestLayer)("Kotori API", (it) => {
  it.effect("creates an account and authenticates with its token", () =>
    Effect.gen(function*() {
      const api = yield* client
      token = null
      const unauthorized = yield* api.account.me().pipe(Effect.flip)
      assert.strictEqual(unauthorized._tag, "Unauthorized")

      const session = yield* api.account.create({ payload: { nativeLanguage: "en", timezone: "Asia/Tokyo" } })
      assert.strictEqual(session.profile.targetLanguage, "ja")
      token = session.token

      const me = yield* api.account.me()
      assert.strictEqual(me.id, session.profile.id)

      const updated = yield* api.account.update({ payload: { dailyNewLimit: 5, timezone: "Not/AZone" } })
      assert.strictEqual(updated.dailyNewLimit, 5)
      assert.strictEqual(updated.timezone, "Asia/Tokyo")
    }).pipe(Effect.provide(Auth)))

  it.effect("searches in English, Japanese, romaji and conjugated forms", () =>
    Effect.gen(function*() {
      const repo = yield* DictionaryRepo
      yield* repo.insertEntries([
        entry(1, "食べる", "たべる", ["to eat"], ["v1", "vt"]),
        entry(2, "書く", "かく", ["to write"], ["v5k", "vt"]),
        entry(3, "猫", "ねこ", ["cat"], ["n"])
      ])
      yield* repo.rebuildSearchIndex
      const api = yield* client

      const english = yield* api.dictionary.search({ query: { q: "eat" } })
      assert.strictEqual(english.mode, "english")
      assert.strictEqual(english.entries[0]?.headword, "食べる")

      const conjugated = yield* api.dictionary.search({ query: { q: "書きました" } })
      assert.strictEqual(conjugated.entries[0]?.headword, "書く")
      assert.deepStrictEqual(conjugated.entries[0]?.inflection, ["polite"])

      const romaji = yield* api.dictionary.search({ query: { q: "neko" } })
      assert.strictEqual(romaji.mode, "romaji")
      assert.strictEqual(romaji.reading, "ねこ")
      assert.strictEqual(romaji.entries[0]?.headword, "猫")

      const detail = yield* api.dictionary.entry({ params: { id: english.entries[0]!.id } })
      assert.deepStrictEqual(detail.senses[0]?.glosses, ["to eat"])
      assert.deepStrictEqual(detail.enrichment, { nuance: "unavailable", examples: "unavailable", audio: "unavailable" })

      const missing = yield* api.dictionary.entry({ params: { id: 999 as never } }).pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NotFound")
    }).pipe(Effect.provide(Auth)))

  it.effect("schedules saved words with Anki's algorithm", () =>
    Effect.gen(function*() {
      const api = yield* client
      const note = yield* api.study.addNote({
        payload: {
          content: {
            kind: "word",
            entryId: 1 as never,
            senseIndex: 0,
            headword: "食べる",
            reading: "たべる",
            meaning: "to eat",
            hint: null,
            example: null,
            audioUrl: null
          }
        }
      })
      assert.strictEqual(note.cards.length, 2)

      // Saving the same sense again is idempotent.
      const again = yield* api.study.addNote({ payload: { content: note.content } })
      assert.strictEqual(again.id, note.id)

      const queue = yield* api.study.queue({ query: {} })
      assert.deepStrictEqual(queue.counts, { new: 2, learning: 0, review: 0 })
      const first = queue.items[0]!
      assert.strictEqual(first.labels.again, "1m")

      const answered = yield* api.study.answer({ params: { id: first.card.id }, payload: { rating: "easy" } })
      assert.strictEqual(answered.card.queue, "review")
      assert.isAtLeast(answered.card.interval, 3)

      const stats = yield* api.study.stats()
      assert.strictEqual(stats.reviewedToday, 1)
      assert.strictEqual(stats.streak, 1)
      assert.strictEqual(stats.unseen, 1)

      yield* api.study.removeNote({ params: { id: note.id } })
      assert.deepStrictEqual(yield* api.study.notes(), [])
    }).pipe(Effect.provide(Auth)))

  it.effect("reports AI features as unavailable instead of failing", () =>
    Effect.gen(function*() {
      const api = yield* client
      const health = yield* api.health()
      assert.deepStrictEqual(health.features, { coach: false, nuance: false, audio: false })

      const error = yield* api.coach.naturalness({ payload: { text: "私は学生です。" } }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "AiUnavailable")
    }).pipe(Effect.provide(Auth)))
})
