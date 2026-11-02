import { assert, layer } from "@effect/vitest"
import { Auth, AuthWebhooks, TestAuth } from "@kotori/auth"
import { UsersRepo } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Mailbox, MailerMemory } from "@kotori/email"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { WebhooksRoute } from "../src/http/webhooks.ts"

const TestAuthLive = TestAuth.layer
const TestLayer = AuthWebhooks.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Auth.layerMemory, UsersRepo.layer, MailerMemory)),
  Layer.provideMerge(Layer.mergeAll(TestAuthLive, DatabaseMemory))
)

/** POSTs to the route as Neon would, with the test layer's services behind it, and returns the status. */
const post = (headers: Record<string, string>, body: string) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<AuthWebhooks>()
    const request = new Request("http://api.test/webhooks/neon-auth", { method: "POST", headers, body })
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => HttpRouter.toWebHandler(WebhooksRoute, { disableLogger: true })),
      ({ handler }) => Effect.promise(() => handler(request, context)),
      ({ dispose }) => Effect.promise(dispose)
    ).pipe(Effect.map((response) => response.status))
  })

const verification = JSON.stringify({
  event_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "send.otp",
  timestamp: "2026-10-22T12:00:00.000Z",
  context: { endpoint_id: "ep-test-12345678", project_name: "Kotori" },
  user: { id: "a1b2c3d4-e5f6-4890-abcd-ef1234567890", email: "new@example.com", name: "", email_verified: false },
  event_data: { otp_code: "246810", otp_type: "email-verification", expires_at: "2026-10-22T12:15:00.000Z" }
})

layer(TestLayer)("POST /webhooks/neon-auth", (it) => {
  it.effect("refuses unsigned and badly signed requests, then delivers a signed one", () =>
    Effect.gen(function* () {
      const testAuth = yield* TestAuth
      const mailbox = yield* Mailbox
      const headers = yield* testAuth.signWebhook(verification)

      assert.strictEqual(yield* post({ "content-type": "application/json" }, verification), 401)
      assert.strictEqual(yield* post(headers, verification.replace("246810", "246811")), 401)
      assert.deepStrictEqual(yield* mailbox.messages, [])

      assert.strictEqual(yield* post(headers, verification), 204)
      const [email] = yield* mailbox.messages
      assert.strictEqual(email?.to, "new@example.com")
      assert.include(email?.text, "246810")
      // An empty name gets the plain greeting.
      assert.include(email?.text, "Hi,")
    })
  )

  it.effect("answers 5xx, so Neon retries, when the key set is down; 422 for a signed event it can't deliver", () =>
    Effect.gen(function* () {
      const testAuth = yield* TestAuth
      const headers = yield* testAuth.signWebhook(verification)
      testAuth.setReachable(false)
      assert.strictEqual(yield* post(headers, verification), 503)
      testAuth.setReachable(true)

      const noAddress = verification
        .replace("550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001")
        .replace('"email":"new@example.com",', "")
      assert.strictEqual(yield* post(yield* testAuth.signWebhook(noAddress), noAddress), 422)
    })
  )
})
