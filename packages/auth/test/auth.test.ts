import { assert, layer } from "@effect/vitest"
import { DatabaseMemory } from "@kotori/db/testing"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import { generateKeyPair, SignJWT } from "jose"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Auth } from "../src/Auth.ts"

const BASE_PATH = "/neondb/auth"

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
      res.writeHead(503)
      return res.end()
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
    const config = ConfigProvider.fromUnknown({ NEON_AUTH_BASE_URL: `http://127.0.0.1:${port}${BASE_PATH}` })
    return Auth.layer.pipe(Layer.provide(ConfigProvider.layer(config)))
  })
).pipe(Layer.provide(DatabaseMemory))

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
