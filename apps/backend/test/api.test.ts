import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Claude, ClaudeError, ElevenLabs, Jev, JevError, TtsError } from "@kotori/ai"
import { Authorization, EntryId, type EntryRecord, KotoriApi } from "@kotori/contracts"
import { Effect, Layer, Option } from "effect"
import { Headers, HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { Database } from "../src/db/Database.ts"
import { scopedToUser } from "../src/db/scopedToUser.ts"
import { updateUser, userById } from "../src/features/accounts/queries.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { cardWithContent, noteCount, studyDays } from "../src/features/study/queries.ts"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"
import { Auth, TestAuth } from "../src/integrations/auth/Auth.ts"
import { MailerMemory } from "../src/integrations/email/Mailer.ts"
import { makeApp } from "../src/runtime/HttpLayers.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

// No AI providers are configured in tests: the app must degrade gracefully. Mail is captured.
const OfflineProviders = Layer.mergeAll(
  MailerMemory,
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
      synthesize: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not configured" }))
    })
  )
)

// One fake auth server, shared by the app (through Auth.layerMemory) and the tests (to sign up):
// Effect memoizes a layer by reference within a build, so both see the same store.
const TestAuthLive = TestAuth.layer
const App = makeApp(OfflineProviders, DatabaseMemory, Auth.layerMemory.pipe(Layer.provide(TestAuthLive)))
const Handlers = AllHandlers.pipe(Layer.provideMerge(AuthorizationLive), Layer.provideMerge(App))
const TestLayer = Layer.mergeAll(Handlers, TestAuthLive, HttpServer.layerServices, NodeServices.layer)

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
    yield* updateUser(yield* Database, user.id, { status: "approved" })
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
  antonyms: [],
  sources: [],
  wasei: false
})

const entry = (
  id: number,
  headword: string,
  reading: string,
  glosses: Array<string>,
  pos: Array<string>
): EntryRecord => ({
  id: EntryId.make(id),
  language: "ja",
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
      const db = yield* Database
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
      yield* updateUser(db, user.id, { status: "archived" })
      assert.strictEqual((yield* api.account.me()).status, "archived")
      assert.strictEqual((yield* api.study.notes().pipe(Effect.flip))._tag, "PendingApproval")

      yield* updateUser(db, user.id, { status: "approved" })
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
      const db = yield* Database
      yield* signedIn("search@example.com")
      yield* insertEntries(db, [
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

      // Japanese speakers learning English search the English dictionary the same way round.
      yield* insertEntries(db, [
        {
          ...entry(100000001, "eat", "/iːt/", ["～を食べる"], ["v"]),
          language: "en",
          forms: [
            { kind: "spelling", text: "eat", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
          ]
        }
      ])
      yield* api.account.update({ payload: { nativeLanguage: "ja" } })
      const word = yield* api.dictionary.search({ query: { q: "eat" } })
      assert.deepStrictEqual(
        word.entries.map((summary) => [summary.headword, summary.language]),
        [["eat", "en"]]
      )
      assert.strictEqual((yield* api.dictionary.search({ query: { q: "食べる" } })).entries[0]?.headword, "eat")
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
      assert.strictEqual(note.cards.length, 1)
      assert.strictEqual(note.cards[0]?.template, "recognize")

      // Saving the same sense again is idempotent.
      const again = yield* api.study.addNote({ payload: { content: note.content } })
      assert.strictEqual(again.id, note.id)

      const queue = yield* api.study.queue({ query: {} })
      assert.deepStrictEqual(queue.counts, { new: 1, learning: 0, review: 0 })
      assert.strictEqual(queue.items.length, 1)
      const first = queue.items[0]!
      assert.strictEqual(first.labels.again, "1m")

      const answered = yield* api.study.answer({ params: { id: first.card.id }, payload: { rating: "easy" } })
      assert.strictEqual(answered.card.queue, "review")
      assert.isAtLeast(answered.card.interval, 3)

      const stats = yield* api.study.stats()
      assert.strictEqual(stats.reviewedToday, 1)
      assert.strictEqual(stats.streak, 1)
      assert.strictEqual(stats.cards, 1)
      assert.strictEqual(stats.unseen, 0)

      yield* api.study.removeNote({ params: { id: note.id } })
      assert.deepStrictEqual(yield* api.study.notes(), [])
    }).pipe(Effect.provide(Session))
  )

  it.effect("deletes a note for its owner only, along with the card and review log", () =>
    Effect.gen(function* () {
      const owner = yield* signedIn("remove-owner@example.com")
      const api = yield* client
      const db = yield* Database
      const own = scopedToUser(db, owner.id)
      const phrase = {
        kind: "phrase" as const,
        text: "お邪魔します",
        furigana: null,
        meaning: "excuse me",
        note: null,
        register: "polite" as const,
        source: "manual" as const
      }
      const note = yield* api.study.addNote({ payload: { content: phrase } })
      const cardId = note.cards[0]!.id
      yield* api.study.answer({ params: { id: cardId }, payload: { rating: "good" } })
      assert.isAtLeast((yield* studyDays(own)).length, 1)

      // No session: refused before the note is looked up.
      const ownerCookie = owner.cookie
      cookie = null
      bearer = null
      assert.strictEqual(
        (yield* api.study.removeNote({ params: { id: note.id } }).pipe(Effect.flip))._tag,
        "Unauthorized"
      )

      // A different learner gets NotFound, and the note is still there.
      const other = yield* signedIn("remove-other@example.com")
      const denied = yield* api.study.removeNote({ params: { id: note.id } }).pipe(Effect.flip)
      assert.strictEqual(denied._tag, "NotFound")
      const kept = yield* api.study.addNote({ payload: { content: { ...phrase, text: "失礼します" } } })

      cookie = ownerCookie
      assert.strictEqual((yield* api.study.notes()).map((row) => row.id).join(), note.id)
      yield* api.study.removeNote({ params: { id: note.id } })
      assert.deepStrictEqual(yield* api.study.notes(), [])
      assert.deepStrictEqual((yield* api.study.queue({ query: {} })).counts, { new: 0, learning: 0, review: 0 })
      const stats = yield* api.study.stats()
      assert.strictEqual(stats.notes, 0)
      assert.strictEqual(stats.cards, 0)
      assert.deepStrictEqual(stats.due, { new: 0, learning: 0, review: 0 })
      assert.isTrue(Option.isNone(yield* cardWithContent(own, cardId)))
      assert.deepStrictEqual(yield* studyDays(own), [])
      assert.strictEqual(yield* noteCount(own), 0)

      // Deleting again, or deleting an id that was never saved, is a success.
      yield* api.study.removeNote({ params: { id: note.id } })
      yield* api.study.removeNote({ params: { id: "00000000-0000-4000-8000-000000000099" as typeof note.id } })

      cookie = other.cookie
      assert.deepStrictEqual(
        (yield* api.study.notes()).map((row) => row.id),
        [kept.id]
      )
      assert.isTrue(Option.isSome(yield* cardWithContent(scopedToUser(db, other.id), kept.cards[0]!.id)))
    }).pipe(Effect.provide(Session))
  )

  it.effect("saves one target-language card per note", () =>
    Effect.gen(function* () {
      yield* signedIn("one-card@example.com")
      const api = yield* client
      const note = yield* api.study.addNote({
        payload: {
          content: {
            kind: "phrase",
            text: "いってきます",
            furigana: null,
            meaning: "I'm off",
            note: null,
            register: null,
            source: "manual"
          }
        }
      })
      assert.deepStrictEqual(
        note.cards.map((card) => card.template),
        ["recognize"]
      )
      const queue = yield* api.study.queue({ query: {} })
      assert.deepStrictEqual(queue.counts, { new: 1, learning: 0, review: 0 })
      assert.strictEqual(queue.items[0]?.card.id, note.cards[0]?.id)
    }).pipe(Effect.provide(Session))
  )

  it.effect("deleting the account removes the profile and study data", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const user = yield* signedIn("leaving@example.com")
      const api = yield* client
      const auth = yield* Auth
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
      assert.isTrue(Option.isSome(yield* userById(db, user.id)))

      const token = yield* Effect.flatMap(TestAuth, (testAuth) => testAuth.token(user.cookie))

      // Deleting the account removes the learner's data and their identity (so the session dies too).
      yield* api.account.delete()
      assert.isTrue(Option.isNone(yield* auth.sessionFromCookies(Headers.fromInput({ cookie: user.cookie }))))

      assert.isTrue(Option.isNone(yield* userById(db, user.id)))
      assert.strictEqual(yield* noteCount(scopedToUser(yield* Database, user.id)), 0)
      const gone = yield* api.account.me().pipe(Effect.flip)
      assert.strictEqual(gone._tag, "Unauthorized")

      // A JWT issued before the deletion is still unexpired, but must not bring the profile back.
      cookie = null
      bearer = token
      assert.strictEqual((yield* api.account.me().pipe(Effect.flip))._tag, "Unauthorized")
      assert.isTrue(Option.isNone(yield* userById(db, user.id)))
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
