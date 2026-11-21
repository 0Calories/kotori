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
import { mergeEntry } from "../src/features/asks/review.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { noteByEntry, noteCount } from "../src/features/notebook/queries.ts"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"
import { Auth, TestAuth } from "../src/integrations/auth/Auth.ts"
import { MailerMemory } from "../src/integrations/email/Mailer.ts"
import { AudioStore } from "../src/features/audio/AudioStore.ts"
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
const App = makeApp(
  OfflineProviders,
  DatabaseMemory,
  Auth.layerMemory.pipe(Layer.provide(TestAuthLive)),
  AudioStore.database
)
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

const client = HttpApiTest.groups(KotoriApi, ["system", "account", "dictionary", "coach", "notebook", "audio"])

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
  origins: [],
  wasei: false
})

const entry = (
  id: number | string,
  headword: string,
  reading: string,
  glosses: Array<string>,
  pos: Array<string>
): EntryRecord => ({
  id: EntryId.make(typeof id === "number" ? `jmdict:${id}` : id),
  language: "ja",
  source: "jmdict",
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
      const gatedNotebook = yield* api.notebook.notes().pipe(Effect.flip)
      assert.strictEqual(gatedNotebook._tag, "PendingApproval")

      // Archiving changes nothing for the learner.
      yield* updateUser(db, user.id, { status: "archived" })
      assert.strictEqual((yield* api.account.me()).status, "archived")
      assert.strictEqual((yield* api.notebook.notes().pipe(Effect.flip))._tag, "PendingApproval")

      yield* updateUser(db, user.id, { status: "approved" })
      assert.deepStrictEqual(yield* api.notebook.notes(), [])

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

      // Picking a language completes onboarding.
      const updated = yield* api.account.update({
        payload: { nativeLanguage: "ja", displayName: "Updated Learner" }
      })
      assert.strictEqual(updated.targetLanguage, "en")
      assert.strictEqual(updated.onboarded, true)
      assert.strictEqual(updated.displayName, "Updated Learner")
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
      assert.deepStrictEqual(detail.cautions, [])
      assert.deepStrictEqual(detail.senses[0]?.examples, [])
      assert.strictEqual(detail.audioUrl, null)
      assert.deepStrictEqual(detail.audio, [])

      const missing = yield* api.dictionary.entry({ params: { id: EntryId.make("jmdict:999") } }).pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NotFound")

      // English learners search the English dictionary the same way round, including deterministic
      // string IDs with spaces and case-preserving twins (en:May vs en:may).
      yield* insertEntries(db, [
        {
          ...entry("en:eat", "eat", "/iːt/", ["～を食べる"], ["v"]),
          language: "en",
          forms: [
            { kind: "spelling", text: "eat", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
          ]
        },
        {
          ...entry("en:run into", "run into", "", ["偶然出会う"], ["v"]),
          language: "en",
          forms: [
            {
              kind: "spelling",
              text: "run into",
              common: true,
              tags: [],
              priorities: [],
              restrictions: [],
              noKanji: false
            }
          ]
        },
        {
          ...entry("en:May", "May", "", ["5月"], ["n"]),
          language: "en",
          forms: [
            { kind: "spelling", text: "May", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
          ]
        },
        {
          ...entry("en:may", "may", "", ["～かもしれない"], ["v"]),
          language: "en",
          forms: [
            { kind: "spelling", text: "may", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
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

      // Multi-word and case-preserving English EntryIds round-trip cleanly over HTTP path params.
      const runInto = yield* api.dictionary.entry({ params: { id: EntryId.make("en:run into") } })
      assert.strictEqual(runInto.id, EntryId.make("en:run into"))
      assert.strictEqual(runInto.headword, "run into")
      const upperMay = yield* api.dictionary.entry({ params: { id: EntryId.make("en:May") } })
      const lowerMay = yield* api.dictionary.entry({ params: { id: EntryId.make("en:may") } })
      assert.strictEqual(upperMay.senses[0]?.glosses[0], "5月")
      assert.strictEqual(lowerMay.senses[0]?.glosses[0], "～かもしれない")
    }).pipe(Effect.provide(Session))
  )

  it.effect("saves and removes entries in the notebook idempotently", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* signedIn("notebook@example.com")
      const eat = entry(101, "食べる", "たべる", ["to eat"], ["v1", "vt"])
      const discarded = entry("kotori:discarded-note-test", "ボツ", "ぼつ", ["discarded"], ["n"])
      yield* insertEntries(db, [eat])
      yield* insertEntries(db, [discarded], { reviewState: "discarded" })
      const api = yield* client

      const note = yield* api.notebook.addNote({ payload: { entryId: eat.id } })
      assert.strictEqual(note.entry.id, eat.id)
      assert.strictEqual(note.entry.headword, "食べる")
      assert.deepStrictEqual(note.senses, [{ glosses: ["to eat"] }])

      // Saving the same entry again is idempotent.
      const again = yield* api.notebook.addNote({ payload: { entryId: eat.id } })
      assert.strictEqual(again.id, note.id)

      const missing = yield* api.notebook
        .addNote({ payload: { entryId: EntryId.make("jmdict:999999") } })
        .pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NotFound")

      const rejected = yield* api.notebook.addNote({ payload: { entryId: discarded.id } }).pipe(Effect.flip)
      assert.strictEqual(rejected._tag, "InvalidRequest")

      assert.strictEqual((yield* api.notebook.notes()).length, 1)

      yield* api.notebook.removeNote({ params: { id: note.id } })
      assert.deepStrictEqual(yield* api.notebook.notes(), [])
    }).pipe(Effect.provide(Session))
  )

  it.effect("deletes a note for its owner only", () =>
    Effect.gen(function* () {
      const owner = yield* signedIn("remove-owner@example.com")
      const api = yield* client
      const db = yield* Database
      const own = scopedToUser(db, owner.id)
      const first = entry(201, "お邪魔します", "おじゃまします", ["excuse me"], ["exp"])
      const second = entry(202, "失礼します", "しつれいします", ["excuse me"], ["exp"])
      yield* insertEntries(db, [first, second])
      const note = yield* api.notebook.addNote({ payload: { entryId: first.id } })

      // No session: refused before the note is looked up.
      const ownerCookie = owner.cookie
      cookie = null
      bearer = null
      assert.strictEqual(
        (yield* api.notebook.removeNote({ params: { id: note.id } }).pipe(Effect.flip))._tag,
        "Unauthorized"
      )

      // A different learner gets NotFound, and the note is still there.
      const other = yield* signedIn("remove-other@example.com")
      const denied = yield* api.notebook.removeNote({ params: { id: note.id } }).pipe(Effect.flip)
      assert.strictEqual(denied._tag, "NotFound")
      const kept = yield* api.notebook.addNote({ payload: { entryId: second.id } })

      cookie = ownerCookie
      assert.strictEqual((yield* api.notebook.notes()).map((row) => row.id).join(), note.id)
      yield* api.notebook.removeNote({ params: { id: note.id } })
      assert.deepStrictEqual(yield* api.notebook.notes(), [])
      assert.isTrue(Option.isNone(yield* noteByEntry(own, first.id)))
      assert.strictEqual(yield* noteCount(own), 0)

      // Deleting again, or deleting an id that was never saved, is a success.
      yield* api.notebook.removeNote({ params: { id: note.id } })
      yield* api.notebook.removeNote({ params: { id: "00000000-0000-4000-8000-000000000099" as typeof note.id } })

      cookie = other.cookie
      assert.deepStrictEqual(
        (yield* api.notebook.notes()).map((row) => row.id),
        [kept.id]
      )
      assert.isTrue(Option.isSome(yield* noteByEntry(scopedToUser(db, other.id), second.id)))
    }).pipe(Effect.provide(Session))
  )

  it.effect("deleting the account removes the profile and notebook data", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const user = yield* signedIn("leaving@example.com")
      const api = yield* client
      const auth = yield* Auth
      const saved = entry(301, "お疲れ様でした", "おつかれさまでした", ["good work today"], ["exp"])
      yield* insertEntries(db, [saved])
      yield* api.notebook.addNote({ payload: { entryId: saved.id } })
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
      assert.deepStrictEqual(health.features, { coach: false, formality: false, audio: false, email: true })

      const error = yield* api.coach.naturalness({ payload: { text: "私は学生です。" } }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "AiUnavailable")
    }).pipe(Effect.provide(Session))
  )

  it.effect("resolves merged kotori: entry IDs transparently via GET /dictionary/entries/:id", () =>
    Effect.gen(function* () {
      yield* signedIn("merged@example.com")
      const api = yield* client
      const db = yield* Database
      const canonical = entry(1900123, "食べる", "たべる", ["to eat"], ["v1"])
      const dupId = EntryId.make("kotori:dup-taberu")
      yield* insertEntries(db, [canonical])
      yield* insertEntries(db, [{ ...canonical, id: dupId, source: "kotori", headword: "たべる重複" }], {
        reviewState: "unreviewed"
      })
      yield* mergeEntry(db, dupId, canonical.id)

      const resolved = yield* api.dictionary.entry({ params: { id: dupId } })
      assert.strictEqual(resolved.id, canonical.id)
      assert.strictEqual(resolved.headword, "食べる")
      assert.strictEqual(resolved.reviewState, "approved")
    }).pipe(Effect.provide(Session))
  )
})
