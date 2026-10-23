import { assert, describe, it } from "vitest"
import { applySetCookie, cookieHeader, splitSetCookie } from "../src/auth/cookies.ts"

// React Native joins repeated Set-Cookie headers with ", ", as iOS's URL loading system does.
const signIn = [
  "__Secure-neonauth.session_token=abc.def%2B; Path=/; Expires=Thu, 29 Oct 2026 12:00:00 GMT; HttpOnly; Secure; SameSite=None",
  "__Secure-neonauth.session_data=eyJzZXNzaW9uIjp7fX0; Path=/; Max-Age=300; HttpOnly; Secure",
  "theme=dark; Path=/"
].join(", ")

describe("the native session cookie", () => {
  it("splits joined headers without breaking Expires dates", () => {
    const cookies = splitSetCookie(signIn)
    assert.strictEqual(cookies.length, 3)
    assert.include(cookies[0], "Expires=Thu, 29 Oct 2026 12:00:00 GMT")
  })

  it("keeps only the session token, sends it back, and drops it when cleared", () => {
    const now = Date.parse("2026-10-22T12:00:00Z")
    const stored = applySetCookie({}, signIn, now)
    assert.deepStrictEqual(stored, { "__Secure-neonauth.session_token": "abc.def%2B" })
    assert.strictEqual(cookieHeader(stored), "__Secure-neonauth.session_token=abc.def%2B")

    // Unrelated responses change nothing (same object, so nothing is written to storage).
    assert.strictEqual(applySetCookie(stored, null, now), stored)
    assert.strictEqual(applySetCookie(stored, signIn, now), stored)

    // Sign-out clears it with Max-Age=0, or an Expires in the past.
    const cleared = "__Secure-neonauth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure"
    assert.deepStrictEqual(applySetCookie(stored, cleared, now), {})
    const expired = "__Secure-neonauth.session_token=old; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    assert.deepStrictEqual(applySetCookie(stored, expired, now), {})
  })

  it("follows a refreshed session", () => {
    const refreshed = applySetCookie(
      { "better-auth.session_token": "one" },
      "better-auth.session_token=two; Path=/; HttpOnly"
    )
    assert.deepStrictEqual(refreshed, { "better-auth.session_token": "two" })
  })
})
