import { apiUrl } from "../api/config.ts"
import { AuthError } from "./error.ts"
import {
  callbackURL,
  extractGoogleClientId,
  linkCallbackURL,
  normalizeGoogleLinkError,
  VERIFIER_PARAM
} from "./googleReturn.ts"
import { transport } from "./transport"

export { AuthError } from "./error.ts"

const field = (body: unknown, name: string) => {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined
  return typeof value === "string" ? value : undefined
}

const request = async <A>(method: "GET" | "POST", path: string, body?: object): Promise<A> => {
  let response: Response
  try {
    response = await transport.fetch(`${apiUrl}/api/auth${path}`, {
      method,
      headers:
        body === undefined
          ? { accept: "application/json" }
          : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (error) {
    throw new AuthError("OFFLINE", String(error), 0)
  }
  const json: unknown = await response.json().catch(() => null)
  if (response.ok) return json as A
  const message = field(json, "message") ?? ""
  // The proxy answers 502 when Managed Auth is unreachable; like the API's 503, that's not a refusal.
  if (response.status >= 500) throw new AuthError("OFFLINE", message, response.status)
  if (response.status === 429) throw new AuthError("RATE_LIMITED", message, response.status)
  throw new AuthError(field(json, "code") ?? "UNKNOWN", message, response.status)
}

const socialRequest = (path: string, callback: string) =>
  request<{ readonly url: string }>("POST", path, {
    provider: "google",
    callbackURL: callback,
    errorCallbackURL: callback,
    disableRedirect: true
  })

/** Managed Better Auth's REST endpoints, through the API's `/api/auth` proxy. */
export const managedAuth = {
  signUp: (input: { readonly email: string; readonly password: string; readonly name: string }) =>
    request<unknown>("POST", "/sign-up/email", input),
  signIn: (input: { readonly email: string; readonly password: string }) =>
    request<unknown>("POST", "/sign-in/email", input),
  signOut: () => request<unknown>("POST", "/sign-out", {}),
  /**
   * Starts a Google sign-in (or sign-up: Managed Auth makes the account on first sight).
   * Answers Google's consent page; the response also sets the challenge cookie the
   * return is traded with. Google's answer comes back through `/auth/return` to `returnTo`.
   */
  startGoogle: (returnTo: string) => socialRequest("/sign-in/social", callbackURL(apiUrl, returnTo)),
  /**
   * Attaches Google to the signed-in learner's account, so they can sign in with Google
   * from then on instead of typing their password.
   */
  linkGoogle: (returnTo: string) => socialRequest("/link-social", linkCallbackURL(apiUrl, returnTo)),
  /**
   * Reads the Google OAuth `client_id` configured on Managed Auth (verifying the active session
   * at the same time) so web account linking can request an OIDC `id_token` directly from Google.
   */
  googleLinkClientId: async (): Promise<string> => {
    try {
      const { url } = await request<{ readonly url: string }>("POST", "/link-social", {
        provider: "google",
        disableRedirect: true
      })
      return extractGoogleClientId(url)
    } catch (error) {
      throw normalizeGoogleLinkError(error)
    }
  },
  /** Attaches Google to the signed-in learner's account using a verified Google OIDC `id_token`. */
  completeGoogleLink: async (idToken: { readonly token: string; readonly nonce: string }) => {
    try {
      return await request<unknown>("POST", "/link-social", { provider: "google", idToken })
    } catch (error) {
      throw normalizeGoogleLinkError(error)
    }
  },
  /** The sign-in methods (`"credential"`, `"google"`, …) attached to the signed-in account. */
  listAccounts: () => request<ReadonlyArray<{ readonly providerId: string }>>("GET", "/list-accounts"),
  /** Trades the verifier Managed Auth appended to `callbackURL`, plus the challenge cookie, for a session. */
  finishGoogle: (verifier: string) =>
    request<unknown>("GET", `/get-session?${VERIFIER_PARAM}=${encodeURIComponent(verifier)}`),
  /** A 15-minute EdDSA JWT for the session (the JWT plugin's `GET /token`). */
  token: () => request<{ readonly token: string }>("GET", "/token"),
  /** Emails a verification code (Email OTP); Kotori's webhook sends it in the learner's language. */
  sendVerificationCode: (email: string) =>
    request<unknown>("POST", "/email-otp/send-verification-otp", { email, type: "email-verification" }),
  verifyEmail: (email: string, otp: string) => request<unknown>("POST", "/email-otp/verify-email", { email, otp }),
  /** Emails a reset code (Email OTP), the same way as the verification one. */
  sendPasswordResetCode: (email: string) =>
    request<unknown>("POST", "/email-otp/send-verification-otp", { email, type: "forget-password" }),
  /** Sets a new password from a reset code; the learner then signs in with it. */
  resetPassword: (email: string, otp: string, password: string) =>
    request<unknown>("POST", "/email-otp/reset-password", { email, otp, password }),
  /** Changes the signed-in learner's password, signing their other devices out. */
  changePassword: (currentPassword: string, newPassword: string) =>
    request<unknown>("POST", "/change-password", { currentPassword, newPassword, revokeOtherSessions: true })
}
