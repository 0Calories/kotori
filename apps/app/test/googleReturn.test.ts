import { assert, describe, it } from "vitest"
import { AuthError } from "../src/auth/error.ts"
import {
  callbackURL,
  isNativeAuthCallback,
  linkCallbackURL,
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
      verifier: "v-456"
    })
    assert.deepStrictEqual(readLinkReturn(new URLSearchParams("google=linked")), {
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
