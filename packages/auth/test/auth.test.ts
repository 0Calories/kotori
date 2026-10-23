import { assert, layer } from "@effect/vitest"
import { UsersRepo } from "@kotori/db"
import { DatabaseMemory } from "@kotori/db/testing"
import { Mailbox, MailerMemory } from "@kotori/email"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Auth } from "../src/Auth.ts"
import { signWebhook } from "../src/WebhookSignature.ts"
import { AuthWebhooks } from "../src/Webhooks.ts"

const BASE_PATH = "/neondb/auth"

/** What the stand-in serves as its key set; null answers 503, as during an outage. */
let keySet: { keys: Array<JWK> } | null = null
let upstreamOrigin = ""

const signedInUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "learner@example.com",
  emailVerified: true,
  name: "Learner",
  createdAt: "2026-10-01T00:00:00.000Z"
}

/** A stand-in for Managed Auth's HTTP endpoints, answering by path. */
const upstream = (req: IncomingMessage, res: ServerResponse) => {
  const path = req.url?.slice(BASE_PATH.length).split("?")[0]
  switch (path) {
    case "/verify-email":
      res.writeHead(302, {
        location: "https://app.kotori.test/verified",
        "cache-control": "no-store",
        "set-cookie": ["better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=None"],
        "x-internal": "not relayed"
      })
      return res.end()
    case "/get-session": {
      const cookie = req.headers.cookie ?? ""
      if (cookie.includes("upstream=down")) {
        res.writeHead(503)
        return res.end()
      }
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify(cookie.includes("session=valid") ? { user: signedInUser } : null))
    }
    case "/.well-known/jwks.json":
      if (keySet === null) {
        res.writeHead(503)
        return res.end()
      }
      res.writeHead(200, { "content-type": "application/json" })
      return res.end(JSON.stringify(keySet))
    case "/sign-in/email":
      res.writeHead(200, { "content-type": "application/json", "set-auth-jwt": "jwt-value" })
      return res.end(JSON.stringify({ origin: req.headers.origin ?? null }))
    default:
      res.writeHead(404)
      return res.end()
  }
}

const AuthAgainstUpstream = Layer.unwrap(
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.callback<ReturnType<typeof createServer>>((resume) => {
        const server = createServer(upstream)
        server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
      }),
      (server) =>
        Effect.callback<void>((resume) => {
          server.closeAllConnections()
          server.close(() => resume(Effect.void))
        })
    )
    const { port } = server.address() as AddressInfo
    upstreamOrigin = `http://127.0.0.1:${port}`
    const config = ConfigProvider.fromUnknown({ NEON_AUTH_BASE_URL: `http://127.0.0.1:${port}${BASE_PATH}` })
    return Auth.layer.pipe(Layer.provide(ConfigProvider.layer(config)))
  })
).pipe(Layer.provideMerge(DatabaseMemory))

/** Proxies a request through `Auth.forward` and returns what the client would receive. */
const forward = (path: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const auth = yield* Auth
    const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1/api/auth${path}`, init))
    return HttpServerResponse.toWeb(yield* auth.forward(request, path))
  })

layer(AuthAgainstUpstream)("Auth.forward", (it) => {
  it.effect("relays redirects with their Location, caching headers and cookies", () =>
    Effect.gen(function* () {
      const response = yield* forward("/verify-email?token=t")
      assert.strictEqual(response.status, 302)
      assert.strictEqual(response.headers.get("location"), "https://app.kotori.test/verified")
      assert.strictEqual(response.headers.get("cache-control"), "no-store")
      assert.strictEqual(response.headers.get("content-type"), null)
      assert.strictEqual(response.headers.get("x-internal"), null)
      assert.isTrue(response.headers.getSetCookie()[0]?.startsWith("better-auth.session_token=abc"))
    })
  )

  it.effect("relays JSON bodies and Better Auth's token header, filling in a missing Origin", () =>
    Effect.gen(function* () {
      const response = yield* forward("/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-proto": "https", host: "api.kotori.test" },
        body: JSON.stringify({ email: "learner@example.com", password: "secret" })
      })
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.headers.get("content-type"), "application/json")
      assert.strictEqual(response.headers.get("set-auth-jwt"), "jwt-value")
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { origin: "https://api.kotori.test" })
    })
  )
})

layer(AuthAgainstUpstream)("Auth sessions and tokens", (it) => {
  const cookies = (cookie: string) => Headers.fromInput({ cookie })

  it.effect("tells a signed-out cookie apart from Managed Auth being down", () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      const signedIn = yield* auth.sessionFromCookies(cookies("session=valid"))
      assert.strictEqual(Option.getOrThrow(signedIn).email, "learner@example.com")
      assert.isTrue(Option.isNone(yield* auth.sessionFromCookies(cookies("session=expired"))))
      const down = yield* auth.sessionFromCookies(cookies("upstream=down")).pipe(Effect.flip)
      assert.strictEqual(down._tag, "AuthUpstreamError")
    })
  )

  it.effect("fails instead of rejecting a token when the key set can't be fetched", () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      // A malformed token is rejected before any key is needed.
      assert.isTrue(Option.isNone(yield* auth.verifyToken("not-a-jwt")))
      // A well-formed one needs the JWKS, which answers 503 here.
      const { privateKey } = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      const token = yield* Effect.promise(() =>
        new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setSubject(signedInUser.id).sign(privateKey)
      )
      const down = yield* auth.verifyToken(token).pipe(Effect.flip)
      assert.strictEqual(down._tag, "AuthUpstreamError")
    })
  )
})

layer(AuthAgainstUpstream)("Auth tokens and sessions", (it) => {
  it.effect("accepts a valid token only while its user still has a session", () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      const sql = yield* SqlClient.SqlClient
      // A stand-in for the slice of Managed Auth's schema that the check reads.
      yield* sql`CREATE SCHEMA neon_auth`
      yield* sql`CREATE TABLE neon_auth.session (id TEXT PRIMARY KEY, "userId" UUID NOT NULL)`
      yield* sql`INSERT INTO neon_auth.session (id, "userId") VALUES ('s1', ${signedInUser.id}::uuid)`

      const { privateKey, publicKey } = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      keySet = { keys: [{ ...(yield* Effect.promise(() => exportJWK(publicKey))), kid: "k1", alg: "EdDSA" }] }
      const token = yield* Effect.promise(() =>
        new SignJWT({
          email: signedInUser.email,
          emailVerified: true,
          name: signedInUser.name,
          createdAt: signedInUser.createdAt
        })
          .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
          .setSubject(signedInUser.id)
          .setIssuer(upstreamOrigin)
          .setAudience(upstreamOrigin)
          .setExpirationTime("15m")
          .sign(privateKey)
      )

      assert.strictEqual(Option.getOrThrow(yield* auth.verifyToken(token)).id, signedInUser.id)
      // `kotori revoke` and account deletion both remove the sessions.
      yield* auth.revokeSessions(signedInUser.id)
      assert.isTrue(Option.isNone(yield* auth.verifyToken(token)))
    })
  )
})

/** Managed Auth's webhook signing key, as its key set would publish it. */
const webhookKeys = await generateKeyPair("EdDSA", { crv: "Ed25519" })
const webhookJwk: JWK = { ...(await exportJWK(webhookKeys.publicKey)), kid: "wh1", alg: "EdDSA", use: "sig" }

const WebhooksAgainstUpstream = AuthWebhooks.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(UsersRepo.layer, MailerMemory)),
  Layer.provideMerge(AuthAgainstUpstream)
)

const learner = { id: "00000000-0000-4000-8000-0000000000aa", email: "learner@example.com", name: "Learner" }

/** A `send.otp` (or other) event as Neon documents it, serialised the way it arrives. */
const event = (type: string, data: object, id = crypto.randomUUID()) =>
  JSON.stringify({
    event_id: id,
    event_type: type,
    timestamp: new Date().toISOString(),
    context: { endpoint_id: "ep-test-12345678", project_name: "Kotori" },
    user: { ...learner, email_verified: false, created_at: "2026-10-01T00:00:00.000Z" },
    event_data: { ...data, expires_at: "2026-10-01T00:15:00.000Z", ip_address: "192.0.2.1", user_agent: "Kotori" }
  })

const otp = (type: string, code = "123456") => event("send.otp", { otp_code: code, otp_type: type })

const signed = (body: string, options?: { readonly ageMs?: number; readonly key?: typeof webhookKeys.privateKey }) =>
  Effect.promise(() =>
    signWebhook(options?.key ?? webhookKeys.privateKey, "wh1", body, Date.now() - (options?.ageMs ?? 0))
  )

const receive = (headers: Record<string, string>, body: string) =>
  Effect.flatMap(AuthWebhooks, (webhooks) =>
    webhooks.receive(Headers.fromInput(headers), new TextEncoder().encode(body))
  )

layer(WebhooksAgainstUpstream)("Managed Auth webhooks", (it) => {
  it.effect("emails the code, in English until the learner has picked a language", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const mailbox = yield* Mailbox
      yield* mailbox.clear
      const body = otp("email-verification", "482913")
      assert.strictEqual(yield* receive(yield* signed(body), body), "sent")

      const [email] = yield* mailbox.messages
      assert.strictEqual(email?.to, "learner@example.com")
      assert.include(email?.subject, "confirm your email")
      assert.include(email?.text, "Hi Learner,")
      assert.include(email?.text, "482913")
    })
  )

  it.effect("writes in the learner's language once they've onboarded, and sends links too", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const mailbox = yield* Mailbox
      yield* mailbox.clear
      const users = yield* UsersRepo
      yield* users.ensure({
        id: learner.id,
        status: "pending",
        role: "user",
        nativeLanguage: "ja",
        targetLanguage: "en",
        onboardedAt: Date.now(),
        displayName: null,
        timezone: "Asia/Tokyo",
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        createdAt: Date.now()
      })

      const code = otp("forget-password", "777111")
      yield* receive(yield* signed(code), code)
      const link = event("send.magic_link", {
        link_type: "forget-password",
        link_url: "https://auth.test/reset-password/tok?callbackURL=%2F",
        token: "tok"
      })
      yield* receive(yield* signed(link), link)

      const [byCode, byLink] = yield* mailbox.messages
      assert.include(byCode?.subject, "パスワードの再設定")
      assert.include(byCode?.text, "777111")
      assert.include(byLink?.text, "https://auth.test/reset-password/tok?callbackURL=%2F")
      assert.include(byLink?.html, 'href="https://auth.test/reset-password/tok?callbackURL=%2F"')
      yield* users.delete(learner.id)
    })
  )

  it.effect("refuses anything it can't verify, and sends nothing", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const mailbox = yield* Mailbox
      yield* mailbox.clear
      const body = otp("email-verification")
      const good = yield* signed(body)
      const rejected = (headers: Record<string, string>, payload = body) =>
        receive(headers, payload).pipe(
          Effect.flip,
          Effect.map((error) => (error._tag === "WebhookRejected" ? error.reason : `not rejected: ${error._tag}`))
        )

      assert.strictEqual(yield* rejected({ "content-type": "application/json" }), "missing signature headers")
      // Signed with some other Ed25519 key that claims Neon's key id.
      const forger = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      assert.strictEqual(yield* rejected(yield* signed(body, { key: forger.privateKey })), "bad signature")
      // The body changed after signing (one digit of the code).
      assert.strictEqual(yield* rejected(good, body.replace("123456", "123457")), "bad signature")
      // The timestamp is part of what's signed.
      const timestamp = String(Number(good["x-neon-timestamp"]) + 1)
      assert.strictEqual(yield* rejected({ ...good, "x-neon-timestamp": timestamp }), "bad signature")
      // A compact JWS with the payload attached is not Neon's detached form.
      const [header, , sig] = good["x-neon-signature"]!.split(".")
      assert.strictEqual(yield* rejected({ ...good, "x-neon-signature": `${header}.e30.${sig}` }), "bad signature")
      assert.strictEqual(
        yield* rejected({ ...good, "x-neon-signature-kid": "someone-else" }),
        "no Ed25519 key someone-else in the key set"
      )
      assert.strictEqual(yield* rejected({ ...good, "x-neon-timestamp": "yesterday" }), "malformed timestamp")
      // Correctly signed, but replayed after Neon's five-minute window (the test clock starts at 0).
      yield* TestClock.setTime(Date.now())
      assert.strictEqual(yield* rejected(yield* signed(body, { ageMs: 6 * 60_000 })), "timestamp too old")

      assert.deepStrictEqual(yield* mailbox.messages, [])
    })
  )

  it.effect("ignores other events, doesn't send one event twice, and won't send SMS codes", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const mailbox = yield* Mailbox
      yield* mailbox.clear
      const created = event("user.created", { auth_provider: "credential" })
      assert.strictEqual(yield* receive(yield* signed(created), created), "ignored")

      // Neon retries with the same event id when it didn't see the first answer.
      const body = otp("email-verification")
      assert.strictEqual(yield* receive(yield* signed(body), body), "sent")
      assert.strictEqual(yield* receive(yield* signed(body), body), "duplicate")
      assert.strictEqual((yield* mailbox.messages).length, 1)

      const sms = event("send.otp", { otp_code: "1", otp_type: "sign-in", delivery_preference: "sms" })
      const error = yield* receive(yield* signed(sms), sms).pipe(Effect.flip)
      assert.strictEqual(error._tag, "WebhookUnusable")
    })
  )
})

layer(WebhooksAgainstUpstream)("Managed Auth webhooks during an outage", (it) => {
  it.effect("fails, and sends nothing, when the key set can't be fetched", () =>
    Effect.gen(function* () {
      keySet = null
      const mailbox = yield* Mailbox
      const body = otp("email-verification")
      const error = yield* receive(yield* signed(body), body).pipe(Effect.flip)
      assert.strictEqual(error._tag, "AuthUpstreamError")
      assert.deepStrictEqual(yield* mailbox.messages, [])
    })
  )
})
