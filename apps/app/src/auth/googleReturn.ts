import { AuthError } from "./error.ts"

/** The query parameter Managed Auth appends to `callbackURL` after a social sign-in. */
export const VERIFIER_PARAM = "neon_auth_session_verifier"

/** Dedicated native deep-link path for OAuth returns, ignored by Expo Router (`app/+native-intent.ts`). */
export const NATIVE_CALLBACK_PATH = "auth/callback"

/** What came back from Google: a verifier to trade, `"cancelled"` if backed out, or `null` on a normal load. */
export type GoogleReturn = { readonly verifier: string } | "cancelled" | null

/** What came back from linking Google in Settings: an optional verifier, `"cancelled"`, or `null`. */
export type GoogleLinkReturn = { readonly verifier: string | null } | "cancelled" | null

/** The query parameters Managed Auth adds to the return URL. */
export const RETURN_PARAMS = [VERIFIER_PARAM, "error", "error_description"] as const

/** Marks a return URL as coming from linking Google in Settings rather than signing in. */
export const LINK_PARAM = "google"
export const LINK_VALUE = "linked"

/** The API's `/auth/return`, which forwards Managed Auth's answer on to `to`. */
export const callbackURL = (apiUrl: string, to: string) => `${apiUrl}/auth/return?to=${encodeURIComponent(to)}`

/** The API's `/auth/return` for linking Google in Settings, tagged with `google=linked`. */
export const linkCallbackURL = (apiUrl: string, to: string) => {
  const url = new URL(to)
  url.searchParams.set(LINK_PARAM, LINK_VALUE)
  return callbackURL(apiUrl, url.toString())
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
 * Managed Auth's answer after linking Google in Settings: `{ verifier }` on success,
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
  return { verifier: verifier !== null && verifier !== "" ? verifier : null }
}
