import { apiUrl } from "../api/config.ts"
import { transport } from "./transport"

/**
 * A Managed Auth refusal, by Better Auth's error code (INVALID_EMAIL_OR_PASSWORD,
 * USER_ALREADY_EXISTS, INVALID_OTP…), a Google sign-in's `error` (access_denied,
 * account_not_linked…), or OFFLINE when it, or the API's proxy to it,
 * can't be reached.
 */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

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
   * return is traded with. Google's answer comes back to `callbackURL`, failures included.
   */
  startGoogle: (callbackURL: string) =>
    request<{ readonly url: string }>("POST", "/sign-in/social", {
      provider: "google",
      callbackURL,
      errorCallbackURL: callbackURL,
      disableRedirect: true
    }),
  /**
   * Attaches Google to the signed-in learner's account, so they can sign in with Google
   * from then on instead of typing their password.
   */
  linkGoogle: (callbackURL: string) =>
    request<{ readonly url: string }>("POST", "/link-social", {
      provider: "google",
      callbackURL,
      errorCallbackURL: callbackURL,
      disableRedirect: true
    }),
  /** The sign-in methods (`"credential"`, `"google"`, …) attached to the signed-in account. */
  listAccounts: () => request<ReadonlyArray<{ readonly providerId: string }>>("GET", "/list-accounts"),
  /** Trades the verifier Managed Auth appended to `callbackURL`, plus the challenge cookie, for a session. */
  finishGoogle: (verifier: string) =>
    request<unknown>("GET", `/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`),
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
