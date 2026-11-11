import { AuthError } from "./error.ts"

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"

/** The query parameter Managed Auth appends to `callbackURL` after a social sign-in. */
export const VERIFIER_PARAM = "neon_auth_session_verifier"

/** Dedicated native deep-link path for OAuth returns, ignored by Expo Router (`app/+native-intent.ts`). */
export const NATIVE_CALLBACK_PATH = "auth/callback"

/** What came back from Google: a verifier to trade, `"cancelled"` if backed out, or `null` on a normal load. */
export type GoogleReturn = { readonly verifier: string } | "cancelled" | null

/** What came back from linking Google in Settings: an OIDC `id_token` (web), a verifier (native), `"cancelled"`, or `null`. */
export type GoogleLinkReturn =
  | { readonly kind: "id_token"; readonly idToken: string; readonly nonce: string }
  | { readonly kind: "verifier"; readonly verifier: string | null }
  | "cancelled"
  | null

/** Pending CSRF `state` and OIDC `nonce` kept in `sessionStorage` across the web's Google link redirect. */
export interface PendingGoogleLink {
  readonly state: string
  readonly nonce: string
}

/** The query parameters Managed Auth adds to the return URL. */
export const RETURN_PARAMS = [VERIFIER_PARAM, "error", "error_description"] as const

/** The parameters Google's OIDC `id_token` flow places in the URL hash (or query on refusal). */
export const ID_TOKEN_RETURN_PARAMS = ["id_token", "state", "error", "error_description"] as const

/** Marks a return URL as coming from linking Google in Settings rather than signing in. */
export const LINK_PARAM = "google"
export const LINK_VALUE = "linked"

/** Cryptographically random 128-bit hex token for OAuth `state` and OIDC `nonce`. */
export const randomOAuthToken = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** The API's `/auth/return`, which forwards Managed Auth's answer on to `to`. */
export const callbackURL = (apiUrl: string, to: string) => `${apiUrl}/auth/return?to=${encodeURIComponent(to)}`

/** The API's `/auth/return` for linking Google in Settings, tagged with `google=linked`. */
export const linkCallbackURL = (apiUrl: string, to: string) => {
  const url = new URL(to)
  url.searchParams.set(LINK_PARAM, LINK_VALUE)
  return callbackURL(apiUrl, url.toString())
}

/** Reads the `client_id` configured on Better Auth from the authorization URL `/link-social` returns. */
export const extractGoogleClientId = (authorizationUrl: string): string => {
  let clientId: string | null = null
  try {
    clientId = new URL(authorizationUrl).searchParams.get("client_id")
  } catch {
    clientId = null
  }
  if (clientId === null || clientId === "") {
    throw new AuthError("GOOGLE_FAILED", "Missing Google OAuth client_id", 400)
  }
  return clientId
}

/**
 * Builds a Google OIDC `response_type=id_token` authorization URL so the browser returns directly
 * to `redirectUri` with `#state=...&id_token=...`, bypassing Neon Managed Auth's `/callback/google`
 * state-cookie check (which Neon wraps for `/sign-in/social` via `/init`, but not `/link-social`).
 */
export const buildGoogleIdTokenUrl = (input: {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly nonce: string
}): string => {
  const url = new URL(GOOGLE_AUTHORIZE_URL)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "id_token")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", input.state)
  url.searchParams.set("nonce", input.nonce)
  url.searchParams.set("prompt", "select_account")
  return url.toString()
}

/** Validates Google's OIDC `id_token` fragment/query return against the tab's pending `state` and `nonce`. */
export const readIdTokenReturn = (params: URLSearchParams, expected: PendingGoogleLink | null): GoogleLinkReturn => {
  if (expected === null) return null
  if (params.get("state") !== expected.state) {
    throw new AuthError("GOOGLE_FAILED", "state_mismatch", 400)
  }
  const error = params.get("error")
  if (error === "access_denied") return "cancelled"
  if (error !== null) {
    throw new AuthError("GOOGLE_FAILED", params.get("error_description") ?? error, 400)
  }
  const idToken = params.get("id_token")
  if (idToken === null || idToken === "") {
    throw new AuthError("GOOGLE_FAILED", "missing_id_token", 400)
  }
  return { kind: "id_token", idToken, nonce: expected.nonce }
}

/** Maps Better Auth's `POST /link-social` (`idToken`) error codes onto Kotori's localized `AuthError` codes. */
export const normalizeGoogleLinkError = (error: unknown): unknown => {
  if (!(error instanceof AuthError)) return error
  if (error.code === "OFFLINE" || error.code === "RATE_LIMITED") return error
  if (error.code === "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED" || error.code === "GOOGLE_EMAIL_MISMATCH") {
    return new AuthError("GOOGLE_EMAIL_MISMATCH", error.message, error.status)
  }
  if (error.code === "SOCIAL_ACCOUNT_ALREADY_LINKED" || error.code === "GOOGLE_ALREADY_LINKED") {
    return new AuthError("GOOGLE_ALREADY_LINKED", error.message, error.status)
  }
  return new AuthError("GOOGLE_FAILED", error.message, error.status)
}

/** Whether a deep-link URL is the native OAuth return (`kotori://auth/callback` or Expo Go's `/--/auth/callback`). */
export const isNativeAuthCallback = (path: string): boolean => {
  const stripped = (path.split(/[?#]/, 1)[0] ?? "").replace(/^([a-z][a-z0-9+.-]*):\/+/i, "$1://")
  return (
    stripped === `/${NATIVE_CALLBACK_PATH}` ||
    stripped.endsWith(`://${NATIVE_CALLBACK_PATH}`) ||
    stripped.endsWith(`/--/${NATIVE_CALLBACK_PATH}`)
  )
}

/**
 * Managed Auth's answer in a return URL: the verifier, `"cancelled"` if the learner backed
 * out, `null` when untouched, or AuthError (GOOGLE_NOT_LINKED, GOOGLE_FAILED) on refusal.
 */
export const readReturn = (params: URLSearchParams): GoogleReturn => {
  const verifier = params.get(VERIFIER_PARAM)
  if (verifier !== null && verifier !== "") return { verifier }
  const error = params.get("error")
  if (error === null) return null
  if (error === "access_denied") return "cancelled"
  // Better Auth's codes when the address already has a password account it won't attach Google to.
  const notLinked = error === "account_not_linked" || error === "unable_to_link_account"
  throw new AuthError(notLinked ? "GOOGLE_NOT_LINKED" : "GOOGLE_FAILED", params.get("error_description") ?? error, 400)
}

/**
 * Managed Auth's answer after linking Google in Settings: `{ kind: "verifier", verifier }` on success,
 * `"cancelled"` if backed out, `null` when untouched, or AuthError on refusal.
 */
export const readLinkReturn = (params: URLSearchParams): GoogleLinkReturn => {
  const error = params.get("error")
  if (error === "access_denied") return "cancelled"
  if (error !== null) {
    const code =
      error === "email_does_not_match"
        ? "GOOGLE_EMAIL_MISMATCH"
        : error === "account_already_linked_to_different_user"
          ? "GOOGLE_ALREADY_LINKED"
          : "GOOGLE_FAILED"
    throw new AuthError(code, params.get("error_description") ?? error, 400)
  }
  if (params.get(LINK_PARAM) !== LINK_VALUE) return null
  const verifier = params.get(VERIFIER_PARAM)
  return { kind: "verifier", verifier: verifier !== null && verifier !== "" ? verifier : null }
}
