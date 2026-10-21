import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError } from "@kotori/ai"
import { DatabaseMemory, DictionaryRepo, type EntryRecord, UsersRepo } from "@kotori/db"
import { Authorization, KotoriApi } from "@kotori/domain"
import { Mailbox, MailerMemory } from "@kotori/email"
import { Jev, JevError } from "@kotori/nuance"
import { Pronouncer, TtsError } from "@kotori/tts"
import { Effect, Layer, Option } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { Auth } from "@kotori/auth"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"
import { makeApp } from "../src/layers.ts"

// No AI providers are configured in tests: the app must degrade gracefully. Mail is captured.
const OfflineProviders = Layer.mergeAll(
  MailerMemory,
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

const App = Auth.layerMemory.pipe(Layer.provideMerge(makeApp(OfflineProviders, DatabaseMemory)))
const Handlers = AllHandlers.pipe(Layer.provideMerge(AuthorizationLive), Layer.provideMerge(App))
const TestLayer = Layer.mergeAll(Handlers, HttpServer.layerServices, NodeServices.layer)

// The session cookie Better Auth issued, forwarded like the app does.
let cookie: string | null = null
const Session = HttpApiMiddleware.layerClient(
  Authorization,
  ({ next, request }) => next(cookie === null ? request : HttpClientRequest.setHeader(request, "cookie", cookie))
)

const client = HttpApiTest.groups(KotoriApi, ["system", "account", "dictionary", "coach", "study", "audio"])

const PASSWORD = "correct-horse-battery-staple"

/** Signs up through Better Auth's server API and returns the user's id and session cookie. */
const signUp = (email: string) =>
  Effect.gen(function*() {
    const auth = yield* Auth
    const result = yield* Effect.promise(() =>
      auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Test Learner" }, returnHeaders: true })
    )
    const setCookie = result.headers.get("set-cookie") ?? ""
    return { id: result.response.user.id, cookie: setCookie.split(";")[0]! }
  })

/** A signed-up, approved learner whose cookie is used for subsequent calls. */
const signedIn = (email: string) =>
  Effect.gen(function*() {
    const auth = yield* Auth
    const user = yield* signUp(email)
    yield* auth.updateUser(user.id, { status: "approved" })
    cookie = user.cookie
    return user
  })

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
  it.effect("signs up, waits for approval, then gets access", () =>
    Effect.gen(function*() {
      const api = yield* client
      const auth = yield* Auth

      cookie = null
      const unauthorized = yield* api.account.me().pipe(Effect.flip)
      assert.strictEqual(unauthorized._tag, "Unauthorized")

      const user = yield* signUp("pending@example.com")
      cookie = user.cookie

      // Signing up sends a verification email.
      const mail = yield* (yield* Mailbox).messages
      assert.strictEqual(mail.at(-1)?.to, "pending@example.com")
      assert.include(mail.at(-1)?.text, "/api/auth/verify-email?token=")

      // The profile is created on first sight and reports the approval state.
      const me = yield* api.account.me()
      assert.strictEqual(me.id, user.id)
      assert.strictEqual(me.email, "pending@example.com")
      assert.strictEqual(me.status, "pending")
      assert.strictEqual(me.onboarded, false)
      assert.strictEqual(me.displayName, "Test Learner")

      // Everything else is closed until Ash approves.
      const gated = yield* api.dictionary.search({ query: { q: "eat" } }).pipe(Effect.flip)
      assert.strictEqual(gated._tag, "PendingApproval")
      const gatedStudy = yield* api.study.notes().pipe(Effect.flip)
      assert.strictEqual(gatedStudy._tag, "PendingApproval")

      // Archiving changes nothing for the learner.
      yield* auth.updateUser(user.id, { status: "archived" })
      assert.strictEqual((yield* api.account.me()).status, "archived")
      assert.strictEqual((yield* api.study.notes().pipe(Effect.flip))._tag, "PendingApproval")

      yield* auth.updateUser(user.id, { status: "approved" })
      assert.deepStrictEqual(yield* api.study.notes(), [])

      // Picking a language completes onboarding; bad time zones are ignored.
      const updated = yield* api.account.update({ payload: { nativeLanguage: "ja", dailyNewLimit: 5, timezone: "Not/AZone" } })
      assert.strictEqual(updated.targetLanguage, "en")
      assert.strictEqual(updated.onboarded, true)
      assert.strictEqual(updated.dailyNewLimit, 5)
      assert.strictEqual(updated.timezone, "UTC")
    }).pipe(Effect.provide(Session)))

  it.effect("searches in English, Japanese, romaji and conjugated forms", () =>
    Effect.gen(function*() {
      yield* signedIn("search@example.com")
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
    }).pipe(Effect.provide(Session)))

  it.effect("schedules saved words with Anki's algorithm", () =>
    Effect.gen(function*() {
      yield* signedIn("study@example.com")
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
    }).pipe(Effect.provide(Session)))

  it.effect("deleting the account removes the profile and study data", () =>
    Effect.gen(function*() {
      const user = yield* signedIn("leaving@example.com")
      const api = yield* client
      const auth = yield* Auth
      const users = yield* UsersRepo
      const sql = yield* SqlClient.SqlClient

      yield* api.study.addNote({
        payload: {
          content: {
            kind: "phrase",
            text: "お疲れ様でした",
            furigana: null,
            meaning: "good work today",
            note: null,
            register: null,
            source: "manual"
          }
        }
      })
      assert.isTrue(Option.isSome(yield* users.byId(user.id)))

      yield* Effect.promise(() =>
        auth.api.deleteUser({ headers: new Headers({ cookie: user.cookie }), body: { password: PASSWORD } })
      )

      assert.isTrue(Option.isNone(yield* users.byId(user.id)))
      const notes = yield* sql<{ n: number }>`SELECT count(*) AS n FROM notes WHERE user_id = ${user.id}`
      assert.strictEqual(notes[0]?.n, 0)
      const gone = yield* api.account.me().pipe(Effect.flip)
      assert.strictEqual(gone._tag, "Unauthorized")
    }).pipe(Effect.provide(Session)))

  it.effect("reports AI features as unavailable instead of failing", () =>
    Effect.gen(function*() {
      yield* signedIn("coach@example.com")
      const api = yield* client
      const health = yield* api.health()
      assert.deepStrictEqual(health.features, { coach: false, nuance: false, audio: false, email: true })

      const error = yield* api.coach.naturalness({ payload: { text: "私は学生です。" } }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "AiUnavailable")
    }).pipe(Effect.provide(Session)))
})
