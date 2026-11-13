import { assert, describe, it } from "vitest"
import { redactReturnParams } from "../src/auth/googleReturn.ts"
import { redactDeep, sentryRedaction } from "../src/lib/sentryRedaction.ts"

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"

describe("Sentry redaction of Google return parameters", () => {
  it("blanks return parameters in a query string and keeps the rest of the URL", () => {
    assert.strictEqual(
      redactReturnParams("https://hellokotori.com/sign-in?neon_auth_session_verifier=v-123&lang=ja"),
      "https://hellokotori.com/sign-in?neon_auth_session_verifier=[Filtered]&lang=ja"
    )
    assert.strictEqual(
      redactReturnParams("/sign-in?error=account_not_linked&error_description=Account%20exists"),
      "/sign-in?error=[Filtered]&error_description=[Filtered]"
    )
    assert.strictEqual(
      redactReturnParams("/settings?google=linked&neon_auth_session_verifier=v-456"),
      "/settings?google=linked&neon_auth_session_verifier=[Filtered]"
    )
  })

  it("blanks return parameters in a fragment", () => {
    assert.strictEqual(
      redactReturnParams(`/settings#state=abc123&id_token=${JWT}&authuser=0`),
      "/settings#state=[Filtered]&id_token=[Filtered]&authuser=0"
    )
    assert.strictEqual(
      redactReturnParams(`https://hellokotori.com/settings?tab=account#id_token=${JWT}`),
      "https://hellokotori.com/settings?tab=account#id_token=[Filtered]"
    )
  })

  it("blanks them inside a span name, a message, and a percent-encoded nested URL", () => {
    assert.strictEqual(
      redactReturnParams("GET https://api.hellokotori.com/api/auth/get-session?neon_auth_session_verifier=v-1"),
      "GET https://api.hellokotori.com/api/auth/get-session?neon_auth_session_verifier=[Filtered]"
    )
    assert.strictEqual(
      redactReturnParams("Navigated from /settings#id_token=abc to /settings"),
      "Navigated from /settings#id_token=[Filtered] to /settings"
    )
    assert.strictEqual(
      redactReturnParams(
        "/auth/return?to=https%3A%2F%2Fhellokotori.com%2Fsign-in%3Fneon_auth_session_verifier%3Dv-9%26x%3D1"
      ),
      "/auth/return?to=https%3A%2F%2Fhellokotori.com%2Fsign-in%3Fneon_auth_session_verifier%3D[Filtered]%26x%3D1"
    )
  })

  it("leaves unrelated parameters, look-alike names, and plain text alone", () => {
    for (const text of [
      "/entry/42?lang=ja",
      "/search?q=state%20of%20mind",
      "/x?statement=1&my_state=2&id_tokens=3",
      "the state=ready flag",
      "https://hellokotori.com/settings"
    ]) {
      assert.strictEqual(redactReturnParams(text), text)
    }
  })

  it("redacts history breadcrumbs recorded while the return parameters were stripped", () => {
    assert.deepStrictEqual(
      sentryRedaction.beforeBreadcrumb({
        category: "navigation",
        data: { from: `/settings#state=s-1&id_token=${JWT}`, to: "/settings" }
      }),
      { category: "navigation", data: { from: "/settings#state=[Filtered]&id_token=[Filtered]", to: "/settings" } }
    )
    assert.deepStrictEqual(
      sentryRedaction.beforeBreadcrumb({
        category: "fetch",
        type: "http",
        data: { method: "GET", url: "https://api.test/api/auth/get-session?neon_auth_session_verifier=v-1" }
      }),
      {
        category: "fetch",
        type: "http",
        data: { method: "GET", url: "https://api.test/api/auth/get-session?neon_auth_session_verifier=[Filtered]" }
      }
    )
  })

  it("redacts an event's request, breadcrumbs, and keyed parameter maps", () => {
    const event = sentryRedaction.beforeSend({
      message: "boom",
      level: "error" as const,
      request: {
        url: "https://hellokotori.com/sign-in?neon_auth_session_verifier=v-1",
        query_string: { neon_auth_session_verifier: "v-1", lang: "ja" },
        headers: { Referer: "https://hellokotori.com/settings#id_token=abc", "User-Agent": "UA" }
      },
      breadcrumbs: [{ category: "navigation", data: { from: "/sign-in?error=access_denied", to: "/sign-in" } }],
      extra: { attempts: 2, ok: true, missing: null, error: "GOOGLE_FAILED", state: "offline", id_token: "abc" }
    })
    assert.deepStrictEqual(event, {
      message: "boom",
      level: "error",
      request: {
        url: "https://hellokotori.com/sign-in?neon_auth_session_verifier=[Filtered]",
        query_string: { neon_auth_session_verifier: "[Filtered]", lang: "ja" },
        headers: { Referer: "https://hellokotori.com/settings#id_token=[Filtered]", "User-Agent": "UA" }
      },
      breadcrumbs: [{ category: "navigation", data: { from: "/sign-in?error=[Filtered]", to: "/sign-in" } }],
      extra: { attempts: 2, ok: true, missing: null, error: "GOOGLE_FAILED", state: "offline", id_token: "[Filtered]" }
    })
  })

  it("redacts transaction and span names and attributes", () => {
    const transaction = sentryRedaction.beforeSendTransaction({
      type: "transaction" as const,
      transaction: "/settings#id_token=abc",
      spans: [
        {
          description: "GET https://api.test/api/auth/get-session?neon_auth_session_verifier=v-1",
          data: {
            "url.full": "https://api.test/api/auth/get-session?neon_auth_session_verifier=v-1",
            "http.query": "?neon_auth_session_verifier=v-1"
          }
        }
      ]
    })
    assert.deepStrictEqual(transaction, {
      type: "transaction",
      transaction: "/settings#id_token=[Filtered]",
      spans: [
        {
          description: "GET https://api.test/api/auth/get-session?neon_auth_session_verifier=[Filtered]",
          data: {
            "url.full": "https://api.test/api/auth/get-session?neon_auth_session_verifier=[Filtered]",
            "http.query": "?neon_auth_session_verifier=[Filtered]"
          }
        }
      ]
    })
    assert.deepStrictEqual(
      sentryRedaction.beforeSendSpan({ description: "pageload /sign-in?state=s-1", data: { "sentry.op": "pageload" } }),
      { description: "pageload /sign-in?state=[Filtered]", data: { "sentry.op": "pageload" } }
    )
  })

  it("leaves non-plain objects as they are and stops at a depth limit", () => {
    const date = new Date(0)
    assert.strictEqual(redactDeep({ at: date }).at, date)
    let nested: unknown = "/x?state=s"
    for (let i = 0; i < 50; i++) nested = { nested }
    assert.doesNotThrow(() => redactDeep(nested))
  })
})
