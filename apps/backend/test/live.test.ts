import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import {
  Claude,
  ClaudeError,
  ElevenLabs,
  interpretSense,
  Jev,
  JevError,
  QUESTIONS_VERSION,
  type SenseAnswers,
  TtsError
} from "@kotori/ai"
import { Authorization, type Entry, EntryId, KotoriApi } from "@kotori/contracts"
import { jobs } from "@kotori/db"
import { Effect, Fiber, Layer, Queue, Stream } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { Database } from "../src/db/Database.ts"
import { updateUser } from "../src/features/accounts/queries.ts"
import { AudioStore } from "../src/features/audio/AudioStore.ts"
import { insertEntries } from "../src/features/dictionary/queries.ts"
import { Enrichers } from "../src/features/enrichment/Enrichers.ts"
import { saveExamples, saveNuance } from "../src/features/enrichment/queries.ts"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"
import { Auth, TestAuth } from "../src/integrations/auth/Auth.ts"
import { MailerMemory } from "../src/integrations/email/Mailer.ts"
import { makeApp } from "../src/runtime/HttpLayers.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"
import { makeJobRunner } from "../src/worker/JobRunner.ts"
import { entries } from "./fixtures.ts"

// The API with every paid provider configured, so asking queues all three kinds of enrichment, but
// nothing reaches a provider: the worker's enrichers are fakes that save canned results. The API's
// live updates hear the worker over PGlite's LISTEN/NOTIFY, as two processes would over Postgres.

const ConfiguredProviders = Layer.mergeAll(
  MailerMemory,
  Layer.succeed(
    Claude,
    Claude.of({
      model: "test",
      available: Effect.succeed(true),
      generate: () => Effect.die(new ClaudeError({ reason: "unconfigured", message: "not in tests" }))
    })
  ),
  Layer.succeed(
    Jev,
    Jev.of({ configured: true, model: "test", ask: () => Effect.die(new JevError({ message: "not in tests" })) })
  ),
  Layer.succeed(
    ElevenLabs,
    ElevenLabs.of({
      configured: true,
      model: "test",
      synthesize: () => Effect.die(new TtsError({ reason: "unconfigured", message: "not in tests" }))
    })
  )
)

const answer = { confidence: 0.9, probabilities: {} }
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

/** The worker's enrichers, saving what Jev and Claude would have; audio has nothing to voice. */
const FakeEnrichers = Layer.effect(
  Enrichers,
  Effect.gen(function* () {
    const db = yield* Database
    return Enrichers.of({
      available: Effect.succeed(["nuance", "examples", "audio"]),
      run: (kind, entryId) => {
        const now = new Date(0)
        switch (kind) {
          case "nuance":
            return saveNuance(
              db,
              entryId,
              [0, 1].map((sense) => ({
                sense,
                nuance: interpretSense(senseAnswers, []),
                answers: senseAnswers,
                model: "test",
                questionsVersion: QUESTIONS_VERSION
              })),
              now
            ).pipe(Effect.as("2 senses"))
          case "examples":
            return saveExamples(
              db,
              entryId,
              [
                {
                  sense: 0,
                  ja: "パンを食べる。",
                  furigana: "パンを{食|た}べる。",
                  en: "I eat bread.",
                  formality: "casual",
                  note: null,
                  noteJa: null,
                  model: "test"
                }
              ],
              now
            ).pipe(Effect.as("1 example"))
          case "audio":
            return Effect.succeed("0 clips")
        }
      }
    })
  })
)

const TestAuthLive = TestAuth.layer
const App = makeApp(
  ConfiguredProviders,
  DatabaseMemory,
  Auth.layerMemory.pipe(Layer.provide(TestAuthLive)),
  AudioStore.database
)
const Handlers = AllHandlers.pipe(Layer.provideMerge(AuthorizationLive), Layer.provideMerge(App))
const TestLayer = Layer.mergeAll(
  Handlers,
  FakeEnrichers.pipe(Layer.provide(App)),
  TestAuthLive,
  HttpServer.layerServices,
  NodeServices.layer
)

let cookie: string | null = null
const Session = HttpApiMiddleware.layerClient(Authorization, ({ next, request }) =>
  next(cookie === null ? request : HttpClientRequest.setHeader(request, "cookie", cookie))
)

const client = HttpApiTest.groups(KotoriApi, ["system", "account", "dictionary", "coach", "study", "audio"])

/** Signs up a learner and uses their session from now on; approved unless `pending`. */
const signIn = (email: string, status: "approved" | "pending" = "approved") =>
  Effect.gen(function* () {
    const user = yield* Effect.flatMap(TestAuth, (auth) => auth.signUp(email, "Test Learner"))
    cookie = user.cookie
    yield* (yield* client).account.me()
    if (status === "approved") yield* updateUser(yield* Database, user.id, { status })
    return user
  })

const queuedJobs = Effect.flatMap(Database, (db) =>
  db.select({ kind: jobs.kind, entryId: jobs.entryId, requestedBy: jobs.requestedBy }).from(jobs).pipe(Effect.orDie)
)

const clearJobs = Effect.flatMap(Database, (db) => db.delete(jobs).pipe(Effect.orDie))

const queued = { nuance: "queued", examples: "queued", audio: "queued" }

layer(TestLayer)("Live enrichment", (it) => {
  it.effect("queues nothing for someone signed out, or not yet approved, and won't stream to them", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const api = yield* client
      yield* insertEntries(db, entries)
      const id = entries[0]!.id

      cookie = null
      assert.strictEqual((yield* api.dictionary.enrich({ params: { id } }).pipe(Effect.flip))._tag, "Unauthorized")
      assert.strictEqual((yield* api.dictionary.updates({ params: { id } }).pipe(Effect.flip))._tag, "Unauthorized")
      assert.strictEqual((yield* api.dictionary.entry({ params: { id } }).pipe(Effect.flip))._tag, "Unauthorized")

      cookie = "better-auth.session_token=forged"
      assert.strictEqual((yield* api.dictionary.enrich({ params: { id } }).pipe(Effect.flip))._tag, "Unauthorized")
      assert.strictEqual((yield* api.dictionary.updates({ params: { id } }).pipe(Effect.flip))._tag, "Unauthorized")

      yield* signIn("pending-live@example.com", "pending")
      assert.strictEqual((yield* api.dictionary.enrich({ params: { id } }).pipe(Effect.flip))._tag, "PendingApproval")
      assert.strictEqual((yield* api.dictionary.updates({ params: { id } }).pipe(Effect.flip))._tag, "PendingApproval")

      assert.deepStrictEqual(yield* queuedJobs, [])
    }).pipe(Effect.provide(Session))
  )

  it.effect("looks up and shows entries without queuing anything, and queues all three when asked", () =>
    Effect.gen(function* () {
      const db = yield* Database
      const api = yield* client
      yield* clearJobs
      const user = yield* signIn("reader@example.com")
      const id = entries[1]!.id

      yield* api.dictionary.search({ query: { q: "eat" } })
      const shown = yield* api.dictionary.entry({ params: { id } })
      // Nothing is here yet and it would all be on its way if asked for, but looking asks for nothing.
      assert.deepStrictEqual(shown.enrichment, queued)
      yield* api.dictionary.entry({ params: { id } })
      assert.deepStrictEqual(yield* queuedJobs, [])

      assert.deepStrictEqual(yield* api.dictionary.enrich({ params: { id } }), queued)
      assert.deepStrictEqual(
        (yield* queuedJobs)
          .sort((a, b) => a.kind.localeCompare(b.kind))
          .map((job) => [job.kind, job.entryId, job.requestedBy]),
        [
          ["audio", id, user.id],
          ["examples", id, user.id],
          ["nuance", id, user.id]
        ]
      )

      const missing = yield* api.dictionary.updates({ params: { id: EntryId.make(999) } }).pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NotFound")
      yield* db.delete(jobs).pipe(Effect.orDie)
    }).pipe(Effect.provide(Session))
  )

  it.effect("streams the entry to a watcher as the worker finishes each job, ending once it's all there", () =>
    Effect.gen(function* () {
      const api = yield* client
      yield* clearJobs
      yield* signIn("watcher@example.com")
      const id = entries[0]!.id
      yield* api.dictionary.enrich({ params: { id } })

      const seen = yield* Queue.unbounded<Entry>()
      const updates = yield* api.dictionary.updates({ params: { id } })
      const watching = yield* updates.pipe(
        Stream.runForEach((update) => (update._tag === "Entry" ? Queue.offer(seen, update.entry) : Effect.void)),
        Effect.forkChild
      )

      // First the entry as it stands: everything on its way, nothing written yet.
      const first = yield* Queue.take(seen)
      assert.deepStrictEqual(first.enrichment, queued)
      assert.isNull(first.senses[0]!.nuance)

      // The worker, in its own fiber over its own queries, finishes the jobs one by one.
      const step = yield* makeJobRunner(["nuance", "examples", "audio"])
      while (yield* step) {}

      // The stream ends by itself once nothing is on its way, the last update showing it all.
      yield* Fiber.join(watching)
      const pushed = [first, ...(yield* Queue.clear(seen))]
      assert.isAbove(pushed.length, 1)
      const last = pushed.at(-1)!
      assert.deepStrictEqual(last.enrichment, { nuance: "ready", examples: "ready", audio: "ready" })
      assert.isNotNull(last.senses[0]!.nuance)
      assert.strictEqual(last.senses[0]!.examples[0]?.ja, "パンを食べる。")
      // Watching queued nothing more than the one request did.
      assert.isTrue((yield* queuedJobs).every((job) => job.entryId === id))
    }).pipe(Effect.provide(Session))
  )

  it.effect("ends the stream at once for an entry with nothing on its way", () =>
    Effect.gen(function* () {
      const api = yield* client
      yield* signIn("settled@example.com")
      const id = entries[0]!.id
      const updates = yield* api.dictionary.updates({ params: { id } })
      const all = yield* Stream.runCollect(updates)
      assert.deepStrictEqual(
        all.map((update) => update._tag),
        ["Entry"]
      )
    }).pipe(Effect.provide(Session))
  )
})
