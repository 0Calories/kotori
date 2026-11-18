import { NodeServices } from "@effect/platform-node"
import { assert, layer } from "@effect/vitest"
import { Claude, ElevenLabs, Jev, JevError, TtsError } from "@kotori/ai"
import { Authorization, KotoriApi } from "@kotori/contracts"
import * as SentrySdk from "@sentry/effect/server"
import { Deferred, Effect, Fiber, Layer, Logger } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { Database } from "../src/db/Database.ts"
import { updateUser } from "../src/features/accounts/queries.ts"
import { AudioStore } from "../src/features/audio/AudioStore.ts"
import { AuthorizationLive } from "../src/http/Authorization.ts"
import { AllHandlers } from "../src/http/handlers.ts"
import { Auth, TestAuth } from "../src/integrations/auth/Auth.ts"
import { MailerMemory } from "../src/integrations/email/Mailer.ts"
import { makeApp } from "../src/runtime/HttpLayers.ts"
import { SentryLive } from "../src/runtime/Sentry.ts"
import { DatabaseMemory } from "../src/testing/DatabaseMemory.ts"

// What would go to Sentry: the `before*` hooks see each item fully built from its scopes.
const events: Array<SentrySdk.ErrorEvent> = []
const logs: Array<SentrySdk.Log> = []
const spans: Array<Parameters<NonNullable<SentrySdk.NodeOptions["beforeSendSpan"]>>[0]> = []
const SentryCapture = Layer.mergeAll(
  SentryLive("api", {
    // The client builds nothing without a DSN; this transport never sends.
    dsn: "https://public@sentry.invalid/1",
    transport: () => ({ send: () => Promise.resolve({}), flush: () => Promise.resolve(true) }),
    sendClientReports: false,
    tracesSampleRate: 1,
    beforeSend: (event) => {
      events.push(event)
      return null
    },
    beforeSendLog: (log) => {
      logs.push(log)
      return null
    },
    beforeSendSpan: (span) => {
      spans.push(span)
      return span
    }
  }),
  Logger.layer([SentrySdk.SentryEffectLogger]),
  // Vitest reuses workers across files (`isolate: false`): leave no live client behind.
  Layer.effectDiscard(Effect.addFinalizer(() => Effect.promise(() => SentrySdk.close())))
)

// Learner A's coaching answer waits until learner B's request has failed, then fails too.
const aWaiting = Deferred.makeUnsafe<void>()
const releaseA = Deferred.makeUnsafe<void>()
let calls = 0
const Providers = Layer.mergeAll(
  MailerMemory,
  Layer.succeed(
    Claude,
    Claude.of({
      model: "test",
      available: Effect.succeed(true),
      generate: () =>
        Effect.gen(function* () {
          if (calls++ === 0) {
            yield* Deferred.succeed(aWaiting, undefined)
            yield* Deferred.await(releaseA)
            yield* Effect.logWarning("answer for A")
            return yield* Effect.die(new Error("A's answer broke"))
          }
          yield* Effect.logWarning("answer for B")
          return yield* Effect.die(new Error("B's answer broke"))
        })
    })
  ),
  Layer.succeed(
    Jev,
    Jev.of({ configured: false, model: "test", ask: () => Effect.fail(new JevError({ message: "not configured" })) })
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

const TestAuthLive = TestAuth.layer
const App = makeApp(Providers, DatabaseMemory, Auth.layerMemory.pipe(Layer.provide(TestAuthLive)), AudioStore.database)
const Handlers = AllHandlers.pipe(Layer.provideMerge(AuthorizationLive), Layer.provideMerge(App))
const TestLayer = Layer.mergeAll(Handlers, TestAuthLive, HttpServer.layerServices, NodeServices.layer).pipe(
  Layer.provideMerge(SentryCapture)
)

// Read as each request is made, so a request keeps the cookie that was current when it started.
let cookie: string | null = null
const Session = HttpApiMiddleware.layerClient(Authorization, ({ next, request }) =>
  next(cookie === null ? request : HttpClientRequest.setHeader(request, "cookie", cookie))
)
const client = HttpApiTest.groups(KotoriApi, ["system", "account", "dictionary", "coach", "study", "audio"])

const approvedLearner = (email: string) =>
  Effect.gen(function* () {
    const api = yield* client
    const user = yield* Effect.flatMap(TestAuth, (auth) => auth.signUp(email, "Test Learner"))
    cookie = user.cookie
    yield* api.account.me()
    yield* updateUser(yield* Database, user.id, { status: "approved" })
    return user
  })

const messageOf = (event: SentrySdk.ErrorEvent) => event.exception?.values?.[0]?.value
const logUser = (message: string) => logs.find((log) => log.message === message)?.attributes?.["user.id"]

/** The learners named in the trace that has a span called `name`: on its root span, and on any span. */
const traceUsers = (name: string) => {
  const traceId = spans.find((span) => span.name === name)?.trace_id
  const traced = spans.filter((span) => span.trace_id === traceId)
  return {
    root: traced.find((span) => span.is_segment)?.attributes["user.id"],
    all: new Set(traced.map((span) => span.attributes["user.id"]).filter((id) => id !== undefined))
  }
}

layer(TestLayer)("Sentry telemetry", (it) => {
  it.effect("tags each request's errors, logs and spans with that request's learner when requests overlap", () =>
    Effect.gen(function* () {
      const api = yield* client
      const a = yield* approvedLearner("a@example.com")
      const b = yield* approvedLearner("b@example.com")

      // A's request starts first and is still running when B's fails; then A's fails too.
      cookie = a.cookie
      const requestA = yield* api.coach
        .naturalness({ payload: { text: "私は学生です。" } })
        .pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(aWaiting)
      cookie = b.cookie
      const resultB = yield* api.coach.howToSay({ payload: { text: "Nice to meet you" } }).pipe(Effect.exit)
      yield* Deferred.succeed(releaseA, undefined)
      const resultA = yield* Fiber.join(requestA)
      assert.isTrue(resultA._tag === "Failure" && resultB._tag === "Failure")
      // Error events finish processing asynchronously (source context is read from disk).
      yield* Effect.promise(() => SentrySdk.flush())

      // Each failure is reported once, with its own learner. A's comes after B's request ran, so a
      // process-wide user would tag it with B.
      // (Processing is asynchronous, so the events may arrive in either order.)
      assert.deepStrictEqual(Object.fromEntries(events.map((event) => [messageOf(event), event.user?.id])), {
        "A's answer broke": a.id,
        "B's answer broke": b.id
      })
      assert.strictEqual(events.length, 2)
      assert.strictEqual(logUser("answer for A"), a.id)
      assert.strictEqual(logUser("answer for B"), b.id)
      // Each request's root span names its learner, and no span in either request names the other.
      assert.deepStrictEqual(traceUsers("Coaching.naturalness"), { root: a.id, all: new Set([a.id]) })
      assert.deepStrictEqual(traceUsers("Coaching.howToSay"), { root: b.id, all: new Set([b.id]) })
    }).pipe(Effect.provide(Session))
  )

  it.effect("leaves work outside a request untagged", () =>
    Effect.gen(function* () {
      yield* Effect.logWarning("between requests")
      assert.isUndefined(logUser("between requests"))
    })
  )
})
