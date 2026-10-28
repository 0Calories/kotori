import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError, Coach, ExampleWriter } from "@kotori/ai"
import { Auth } from "@kotori/auth"
import { Database } from "@kotori/db"
import { notes, users } from "@kotori/db/schema"
import { DatabaseMemory } from "@kotori/db/testing"
import { Authorization, KotoriApi } from "@kotori/domain"
import { MailerMemory } from "@kotori/email"
import type { EntryRecord } from "@kotori/jmdict"
import { Jev, JevError } from "@kotori/nuance"
import { Accounts, Dictionary, makeServices } from "@kotori/services"
import { AuthMemory, TestAuth } from "@kotori/services/testing"
import { ElevenLabs, TtsError } from "@kotori/tts"
import { eq } from "drizzle-orm"
import { Effect, Layer, Option } from "effect"
import { Headers, HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"

// No AI providers are configured in tests: the app must degrade gracefully. Mail is captured,
// and Managed Auth is a fake keeping its users and sessions in the test database.
const OfflineProviders = Layer.mergeAll(
  MailerMemory,
  Layer.mergeAll(Coach.layer, ExampleWriter.layer).pipe(
    Layer.provideMerge(
      Layer.succeed(
        Claude,
        Claude.of({
          model: "test",
          available: Effect.succeed(false),
          generate: () => Effect.fail(new ClaudeError({ reason: "unconfigured", message: "not configured" }))
        })
      )
    )
  ),
  Layer.succeed(
    Jev,
    Jev.of({
      configured: false,
      model: "test",
      ask: () => Effect.fail(new JevError({ message: "not configured" }))
    })
  ),
  Layer.succeed(
    ElevenLabs,
    ElevenLabs.of({
      configured: false,
      model: "test",
      voiceFor: () => "test",
      synthesize: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not configured" }))
    })
  ),
  AuthMemory
).pipe(Layer.provideMerge(TestAuth.layer))

const App = makeServices(OfflineProviders, DatabaseMemory)
const Handlers = AllHandlers.pipe(Layer.provideMerge(AuthorizationLive), Layer.provideMerge(App))
const TestLayer = Layer.mergeAll(Handlers, HttpServer.layerServices, NodeServices.layer)

const profileExists = (id: string) =>
  Effect.flatMap(Database, (db) => db.$count(users, eq(users.id, id))).pipe(Effect.map((n) => n > 0))

// The session cookie (web) or managed JWT (app) forwarded with every request.
let cookie: string | null = null
let bearer: string | null = null
const Session = HttpApiMiddleware.layerClient(Authorization, ({ next, request }) =>
  next(
    bearer !== null
      ? HttpClientRequest.bearerToken(request, bearer)
      : cookie === null
        ? request
        : HttpClientRequest.setHeader(request, "cookie", cookie)
  )
)

const client = HttpApiTest.groups(KotoriApi, ["system", "account", "dictionary", "coach", "study", "audio"])

/** Signs up against the (in-memory) managed auth server and returns the user's id and session cookie. */
const signUp = (email: string) => Effect.flatMap(TestAuth, (auth) => auth.signUp(email, "Test Learner"))

/** A signed-up, approved learner whose cookie is used for subsequent calls. */
const signedIn = (email: string) =>
  Effect.gen(function* () {
    const api = yield* client
    const user = yield* signUp(email)
    cookie = user.cookie
    bearer = null
    // The profile row appears on first contact; approval is Kotori's own state.
    yield* api.account.me()
    yield* Accounts.approve(email)
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

const entry = (
  id: number,
  headword: string,
  reading: string,
  glosses: Array<string>,
  pos: Array<string>
): EntryRecord => ({
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
    Effect.gen(function* () {
      const api = yield* client
      const testAuth = yield* TestAuth

      cookie = null
      bearer = null
      const unauthorized = yield* api.account.me().pipe(Effect.flip)
      assert.strictEqual(unauthorized._tag, "Unauthorized")

      const user = yield* signUp("pending@example.com")
      cookie = user.cookie

      // The profile is created on first sight and reports the approval state.
      const me = yield* api.account.me()
      assert.strictEqual(me.id, user.id)
      assert.strictEqual(me.email, "pending@example.com")
      assert.strictEqual(me.status, "pending")
      assert.strictEqual(me.onboarded, false)
      assert.strictEqual(me.displayName, "Test Learner")

      // Everything else is closed until an admin approves.
      const gated = yield* api.dictionary.search({ query: { q: "eat" } }).pipe(Effect.flip)
      assert.strictEqual(gated._tag, "PendingApproval")
      const gatedStudy = yield* api.study.notes().pipe(Effect.flip)
      assert.strictEqual(gatedStudy._tag, "PendingApproval")

      // Archiving changes nothing for the learner.
      yield* Accounts.archive("pending@example.com")
      assert.strictEqual((yield* api.account.me()).status, "archived")
      assert.strictEqual((yield* api.study.notes().pipe(Effect.flip))._tag, "PendingApproval")

      yield* Accounts.approve("pending@example.com")
      assert.deepStrictEqual(yield* api.study.notes(), [])

      // The app authenticates with a managed JWT instead of the cookie.
      cookie = null
      bearer = yield* testAuth.token(user.cookie)
      assert.strictEqual((yield* api.account.me()).id, user.id)
      bearer = "not-a-jwt"
      assert.strictEqual((yield* api.account.me().pipe(Effect.flip))._tag, "Unauthorized")
      bearer = null
      cookie = user.cookie

      // Managed Auth being down is a 503, never a 401 that would sign the learner out.
      const token = yield* testAuth.token(user.cookie)
      testAuth.setReachable(false)
      assert.strictEqual((yield* api.account.me().pipe(Effect.flip))._tag, "AuthUnavailable")
      cookie = null
      bearer = token
      assert.strictEqual((yield* api.account.me().pipe(Effect.flip))._tag, "AuthUnavailable")
      testAuth.setReachable(true)
      assert.strictEqual((yield* api.account.me()).id, user.id)
      bearer = null
      cookie = user.cookie

      // Picking a language completes onboarding; bad time zones are ignored.
      const updated = yield* api.account.update({
        payload: { nativeLanguage: "ja", dailyNewLimit: 5, timezone: "Not/AZone" }
      })
      assert.strictEqual(updated.targetLanguage, "en")
      assert.strictEqual(updated.onboarded, true)
      assert.strictEqual(updated.dailyNewLimit, 5)
      assert.strictEqual(updated.timezone, "UTC")
    }).pipe(Effect.provide(Session))
  )

  it.effect("searches in English, Japanese, romaji and conjugated forms", () =>
    Effect.gen(function* () {
      yield* signedIn("search@example.com")
      yield* Dictionary.insertEntries([
        entry(1, "食べる", "たべる", ["to eat"], ["v1", "vt"]),
        entry(2, "書く", "かく", ["to write"], ["v5k", "vt"]),
        entry(3, "猫", "ねこ", ["cat"], ["n"])
      ])
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
      assert.deepStrictEqual(detail.enrichment, {
        nuance: "unavailable",
        examples: "unavailable",
        audio: "unavailable"
      })

      const missing = yield* api.dictionary.entry({ params: { id: 999 as never } }).pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NotFound")
    }).pipe(Effect.provide(Session))
  )

  it.effect("schedules saved words with Anki's algorithm", () =>
    Effect.gen(function* () {
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
    }).pipe(Effect.provide(Session))
  )

  it.effect("deleting the account removes the profile and study data", () =>
    Effect.gen(function* () {
      const user = yield* signedIn("leaving@example.com")
      const api = yield* client
      const auth = yield* Auth
      const db = yield* Database
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
      assert.isTrue(yield* profileExists(user.id))

      const token = yield* Effect.flatMap(TestAuth, (testAuth) => testAuth.token(user.cookie))

      // Deleting the account removes the learner's data and their identity (so the session dies too).
      yield* api.account.delete()
      assert.isTrue(Option.isNone(yield* auth.sessionFromCookies(Headers.fromInput({ cookie: user.cookie }))))

      assert.isFalse(yield* profileExists(user.id))
      assert.strictEqual(yield* db.$count(notes, eq(notes.userId, user.id)), 0)
      const gone = yield* api.account.me().pipe(Effect.flip)
      assert.strictEqual(gone._tag, "Unauthorized")

      // A JWT issued before the deletion is still unexpired, but must not bring the profile back.
      cookie = null
      bearer = token
      assert.strictEqual((yield* api.account.me().pipe(Effect.flip))._tag, "Unauthorized")
      assert.isFalse(yield* profileExists(user.id))
      bearer = null
    }).pipe(Effect.provide(Session))
  )

  it.effect("reports AI features as unavailable instead of failing", () =>
    Effect.gen(function* () {
      yield* signedIn("coach@example.com")
      const api = yield* client
      const health = yield* api.health()
      assert.deepStrictEqual(health.features, { coach: false, nuance: false, audio: false, email: true })

      const error = yield* api.coach.naturalness({ payload: { text: "私は学生です。" } }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "AiUnavailable")
    }).pipe(Effect.provide(Session))
  )
})
