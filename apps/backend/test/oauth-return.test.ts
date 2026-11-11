import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { webOriginAllowed } from "../src/http/cors.ts"
import { OAuthReturnRoute, returnTarget } from "../src/http/oauth-return.ts"

const WEB = ["https://hellokotori.com", "https://kotori-*-0calories-projects.vercel.app"]

const Route = OAuthReturnRoute.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ KOTORI_WEB_ORIGINS: WEB.join(",") })))
)

/** GETs the route as a browser coming back from Managed Auth would, and returns status and Location. */
const get = (query: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(Route, { disableLogger: true })),
    ({ handler }) => Effect.promise(() => handler(new Request(`http://api.test/auth/return?${query}`))),
    ({ dispose }) => Effect.promise(dispose)
  ).pipe(Effect.map((response) => ({ status: response.status, location: response.headers.get("location") })))

describe("where a Google sign-in may land", () => {
  const production = webOriginAllowed(WEB, true)
  const development = webOriginAllowed(WEB, false)

  it("allows the web app, its previews and the native app", () => {
    assert.isNotNull(returnTarget("https://hellokotori.com/sign-in", production, true))
    assert.isNotNull(returnTarget("https://kotori-abc123-0calories-projects.vercel.app/sign-up", production, true))
    assert.isNotNull(returnTarget("kotori://sign-in", production, true))
  })

  it("allows Expo Go and local dev servers only outside production", () => {
    assert.isNull(returnTarget("exp://192.168.1.20:8081/--/sign-in", production, true))
    assert.isNotNull(returnTarget("exp://192.168.1.20:8081/--/sign-in", development, false))
    assert.isNull(returnTarget("http://localhost:8081/sign-in", production, true))
    assert.isNotNull(returnTarget("http://localhost:8081/sign-in", development, false))
  })

  it("refuses every other site, and anything that isn't a URL", () => {
    for (const to of [
      undefined,
      "",
      "/sign-in",
      "https://evil.example/sign-in",
      "https://hellokotori.com.evil.example/",
      "https://a.b-0calories-projects.vercel.app/",
      "javascript:alert(1)"
    ]) {
      assert.isNull(returnTarget(to, production, true), String(to))
    }
  })
})

describe("GET /auth/return", () => {
  it.effect("forwards Managed Auth's verifier, or its error, to the app", () =>
    Effect.gen(function* () {
      const to = encodeURIComponent("https://hellokotori.com/sign-up")
      const signedIn = yield* get(`to=${to}&neon_auth_session_verifier=v-123`)
      assert.strictEqual(signedIn.status, 302)
      assert.strictEqual(signedIn.location, "https://hellokotori.com/sign-up?neon_auth_session_verifier=v-123")

      const native = yield* get(`to=${encodeURIComponent("kotori://sign-in")}&error=access_denied`)
      assert.strictEqual(native.location, "kotori://sign-in?error=access_denied")
    })
  )

  it.effect("won't send the verifier anywhere else", () =>
    Effect.gen(function* () {
      const response = yield* get(`to=${encodeURIComponent("https://evil.example/")}&neon_auth_session_verifier=v`)
      assert.strictEqual(response.status, 400)
      assert.isNull(response.location)
    })
  )
})
