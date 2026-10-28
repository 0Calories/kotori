import { assert, layer } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Auth } from "../src/Auth.ts"
import { signWebhook } from "../src/WebhookSignature.ts"
import { verifyWebhook } from "../src/Webhooks.ts"

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
)

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
      assert.isTrue(Option.isNone(yield* auth.verifyToken("not-a-jwt", () => Effect.succeed(true))))
      // A well-formed one needs the JWKS, which answers 503 here.
      const { privateKey } = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      const token = yield* Effect.promise(() =>
        new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setSubject(signedInUser.id).sign(privateKey)
      )
      const down = yield* auth.verifyToken(token, () => Effect.succeed(true)).pipe(Effect.flip)
      assert.strictEqual(down._tag, "AuthUpstreamError")
    })
  )
})

layer(AuthAgainstUpstream)("Auth tokens and sessions", (it) => {
  it.effect("accepts a valid token only while its user still has a session", () =>
    Effect.gen(function* () {
      const auth = yield* Auth
      // Sessions live in `neon_auth`; the caller says whether the user still has one.
      const sessions = new Set([signedInUser.id])
      const hasSession = (userId: string) => Effect.sync(() => sessions.has(userId))

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

      assert.strictEqual(Option.getOrThrow(yield* auth.verifyToken(token, hasSession)).id, signedInUser.id)
      // `kotori revoke` and account deletion both remove the sessions.
      sessions.clear()
      assert.isTrue(Option.isNone(yield* auth.verifyToken(token, hasSession)))
    })
  )
})

/** Managed Auth's webhook signing key, as its key set would publish it. */
const webhookKeys = await generateKeyPair("EdDSA", { crv: "Ed25519" })
const webhookJwk: JWK = { ...(await exportJWK(webhookKeys.publicKey)), kid: "wh1", alg: "EdDSA", use: "sig" }

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

const verify = (headers: Record<string, string>, body: string) =>
  verifyWebhook(Headers.fromInput(headers), new TextEncoder().encode(body))

layer(AuthAgainstUpstream)("Managed Auth webhooks", (it) => {
  it.effect("reads the code or link to email, and who it's for, from a verified event", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const body = otp("email-verification", "482913")
      assert.deepStrictEqual(Option.getOrThrow(yield* verify(yield* signed(body), body)), {
        eventId: JSON.parse(body).event_id,
        purpose: "email-verification",
        secret: { code: "482913" },
        to: "learner@example.com",
        userId: learner.id,
        name: "Learner"
      })

      const link = event("send.magic_link", {
        link_type: "forget-password",
        link_url: "https://auth.test/reset-password/tok?callbackURL=%2F",
        token: "tok"
      })
      const reset = Option.getOrThrow(yield* verify(yield* signed(link), link))
      assert.strictEqual(reset.purpose, "forget-password")
      assert.deepStrictEqual(reset.secret, { url: "https://auth.test/reset-password/tok?callbackURL=%2F" })
    })
  )

  it.effect("refuses anything it can't verify", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const body = otp("email-verification")
      const good = yield* signed(body)
      const rejected = (headers: Record<string, string>, payload = body) =>
        verify(headers, payload).pipe(
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
    })
  )

  it.effect("passes over other events and won't deliver SMS codes", () =>
    Effect.gen(function* () {
      keySet = { keys: [webhookJwk] }
      const created = event("user.created", { auth_provider: "credential" })
      assert.isTrue(Option.isNone(yield* verify(yield* signed(created), created)))

      const sms = event("send.otp", { otp_code: "1", otp_type: "sign-in", delivery_preference: "sms" })
      const error = yield* verify(yield* signed(sms), sms).pipe(Effect.flip)
      assert.strictEqual(error._tag, "WebhookUnusable")
    })
  )
})

layer(AuthAgainstUpstream)("Managed Auth webhooks during an outage", (it) => {
  it.effect("fails when the key set can't be fetched", () =>
    Effect.gen(function* () {
      keySet = null
      const body = otp("email-verification")
      const error = yield* verify(yield* signed(body), body).pipe(Effect.flip)
      assert.strictEqual(error._tag, "AuthUpstreamError")
    })
  )
})
