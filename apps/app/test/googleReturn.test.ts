import { assert, describe, it } from "vitest"
import { AuthError } from "../src/auth/error.ts"
import {
  buildGoogleIdTokenUrl,
  callbackURL,
  extractGoogleClientId,
  isNativeAuthCallback,
  linkCallbackURL,
  normalizeGoogleLinkError,
  readIdTokenReturn,
  readLinkReturn,
  readReturn
} from "../src/auth/googleReturn.ts"

const API = "https://api.hellokotori.com"

const expectAuthError = (fn: () => unknown, code: string) => {
  try {
    fn()
    assert.fail(`Expected AuthError(${code})`)
  } catch (error) {
    assert.instanceOf(error, AuthError)
    assert.strictEqual(error.code, code)
  }
}

describe("Google return URLs", () => {
  it("builds sign-in and account-linking callback URLs through /auth/return", () => {
    assert.strictEqual(
      callbackURL(API, "https://hellokotori.com/sign-up"),
      "https://api.hellokotori.com/auth/return?to=https%3A%2F%2Fhellokotori.com%2Fsign-up"
    )
    assert.strictEqual(
      linkCallbackURL(API, "https://hellokotori.com/settings"),
      "https://api.hellokotori.com/auth/return?to=https%3A%2F%2Fhellokotori.com%2Fsettings%3Fgoogle%3Dlinked"
    )
    assert.strictEqual(
      linkCallbackURL(API, "kotori://auth/callback"),
      "https://api.hellokotori.com/auth/return?to=kotori%3A%2F%2Fauth%2Fcallback%3Fgoogle%3Dlinked"
    )
  })

  it("extracts Google client_id from Better Auth's authorization URL and builds an OIDC id_token URL", () => {
    const clientId = extractGoogleClientId(
      "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=919653962426-abc.apps.googleusercontent.com&state=s1"
    )
    assert.strictEqual(clientId, "919653962426-abc.apps.googleusercontent.com")
    expectAuthError(
      () => extractGoogleClientId("https://accounts.google.com/o/oauth2/v2/auth?state=s1"),
      "GOOGLE_FAILED"
    )
    expectAuthError(() => extractGoogleClientId("not a url"), "GOOGLE_FAILED")

    const oidcUrl = new URL(
      buildGoogleIdTokenUrl({
        clientId,
        redirectUri: "https://hellokotori.com/settings",
        state: "state-123",
        nonce: "nonce-456"
      })
    )
    assert.strictEqual(oidcUrl.origin + oidcUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth")
    assert.strictEqual(oidcUrl.searchParams.get("client_id"), "919653962426-abc.apps.googleusercontent.com")
    assert.strictEqual(oidcUrl.searchParams.get("redirect_uri"), "https://hellokotori.com/settings")
    assert.strictEqual(oidcUrl.searchParams.get("response_type"), "id_token")
    assert.strictEqual(oidcUrl.searchParams.get("scope"), "openid email profile")
    assert.strictEqual(oidcUrl.searchParams.get("state"), "state-123")
    assert.strictEqual(oidcUrl.searchParams.get("nonce"), "nonce-456")
    assert.strictEqual(oidcUrl.searchParams.get("prompt"), "select_account")
  })

  it("validates OIDC id_token link returns against CSRF state and maps cancellation and errors", () => {
    const expected = { state: "state-123", nonce: "nonce-456" }
    assert.isNull(readIdTokenReturn(new URLSearchParams("state=state-123&id_token=jwt-1"), null))
    assert.deepStrictEqual(readIdTokenReturn(new URLSearchParams("state=state-123&id_token=jwt-1"), expected), {
      kind: "id_token",
      idToken: "jwt-1",
      nonce: "nonce-456"
    })
    assert.strictEqual(
      readIdTokenReturn(new URLSearchParams("state=state-123&error=access_denied"), expected),
      "cancelled"
    )

    expectAuthError(
      () => readIdTokenReturn(new URLSearchParams("state=wrong&id_token=jwt-1"), expected),
      "GOOGLE_FAILED"
    )
    expectAuthError(() => readIdTokenReturn(new URLSearchParams("id_token=jwt-1"), expected), "GOOGLE_FAILED")
    expectAuthError(() => readIdTokenReturn(new URLSearchParams("state=state-123"), expected), "GOOGLE_FAILED")
    expectAuthError(
      () => readIdTokenReturn(new URLSearchParams("state=state-123&error=redirect_uri_mismatch"), expected),
      "GOOGLE_FAILED"
    )
  })

  it("normalizes Better Auth idToken account-linking error codes while preserving OFFLINE and RATE_LIMITED", () => {
    expectAuthError(() => {
      throw normalizeGoogleLinkError(new AuthError("LINKING_DIFFERENT_EMAILS_NOT_ALLOWED", "Different emails", 401))
    }, "GOOGLE_EMAIL_MISMATCH")
    expectAuthError(() => {
      throw normalizeGoogleLinkError(new AuthError("SOCIAL_ACCOUNT_ALREADY_LINKED", "Already linked", 409))
    }, "GOOGLE_ALREADY_LINKED")
    expectAuthError(() => {
      throw normalizeGoogleLinkError(new AuthError("INVALID_TOKEN", "Invalid id token", 401))
    }, "GOOGLE_FAILED")
    expectAuthError(() => {
      throw normalizeGoogleLinkError(new AuthError("OFFLINE", "Network down", 0))
    }, "OFFLINE")
    expectAuthError(() => {
      throw normalizeGoogleLinkError(new AuthError("RATE_LIMITED", "Slow down", 429))
    }, "RATE_LIMITED")
  })

  it("recognises only the native OAuth callback path across custom schemes and Expo Go", () => {
    assert.isTrue(isNativeAuthCallback("kotori://auth/callback?neon_auth_session_verifier=v-1"))
    assert.isTrue(isNativeAuthCallback("kotori:///auth/callback?error=access_denied"))
    assert.isTrue(isNativeAuthCallback("exp://192.168.1.20:8081/--/auth/callback?google=linked"))
    assert.isTrue(isNativeAuthCallback("/auth/callback?neon_auth_session_verifier=v-1"))

    assert.isFalse(isNativeAuthCallback("kotori://sign-in?error=account_not_linked"))
    assert.isFalse(isNativeAuthCallback("kotori://settings?google=linked"))
    assert.isFalse(isNativeAuthCallback("kotori://entry/42"))
    assert.isFalse(isNativeAuthCallback(""))
  })

  it("reads a sign-in verifier, distinguishes cancellation from an untouched page, and maps errors", () => {
    assert.deepStrictEqual(readReturn(new URLSearchParams("neon_auth_session_verifier=v-123")), {
      verifier: "v-123"
    })
    assert.isNull(readReturn(new URLSearchParams()))
    assert.strictEqual(readReturn(new URLSearchParams("error=access_denied")), "cancelled")

    expectAuthError(() => readReturn(new URLSearchParams("error=account_not_linked")), "GOOGLE_NOT_LINKED")
    expectAuthError(() => readReturn(new URLSearchParams("error=unable_to_link_account")), "GOOGLE_NOT_LINKED")
    expectAuthError(
      () => readReturn(new URLSearchParams("neon_auth_session_verifier=&error=state_mismatch")),
      "GOOGLE_FAILED"
    )
  })

  it("reads a Settings link return, distinguishes cancellation, and maps linking errors", () => {
    assert.deepStrictEqual(readLinkReturn(new URLSearchParams("google=linked&neon_auth_session_verifier=v-456")), {
      kind: "verifier",
      verifier: "v-456"
    })
    assert.deepStrictEqual(readLinkReturn(new URLSearchParams("google=linked")), {
      kind: "verifier",
      verifier: null
    })
    assert.isNull(readLinkReturn(new URLSearchParams()))
    assert.strictEqual(readLinkReturn(new URLSearchParams("google=linked&error=access_denied")), "cancelled")

    expectAuthError(
      () => readLinkReturn(new URLSearchParams("google=linked&error=email_does_not_match")),
      "GOOGLE_EMAIL_MISMATCH"
    )
    expectAuthError(
      () => readLinkReturn(new URLSearchParams("google=linked&error=account_already_linked_to_different_user")),
      "GOOGLE_ALREADY_LINKED"
    )
    expectAuthError(
      () => readLinkReturn(new URLSearchParams("google=linked&error=unable_to_link_account")),
      "GOOGLE_FAILED"
    )
  })
})
