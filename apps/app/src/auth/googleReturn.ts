import { apiUrl } from "../api/config.ts"
import { AuthError } from "./client.ts"

/** What came back from Google: a verifier to trade for a session, or nothing (the learner backed out). */
export type GoogleReturn = { readonly verifier: string } | null

/** What came back from linking Google in Settings: an optional verifier, or nothing (the learner backed out). */
export type GoogleLinkReturn = { readonly verifier: string | null } | null

/** The query parameters Managed Auth adds to the return URL. */
export const RETURN_PARAMS = ["neon_auth_session_verifier", "error", "error_description"] as const

/** Marks a return URL as coming from linking Google in Settings rather than signing in. */
export const LINK_PARAM = "google"
export const LINK_VALUE = "linked"

/** The API's `/auth/return`, which forwards Managed Auth's answer on to `to`. */
export const callbackURL = (to: string) => `${apiUrl}/auth/return?to=${encodeURIComponent(to)}`

/** The API's `/auth/return` for linking Google in Settings, tagged with `google=linked`. */
export const linkCallbackURL = (to: string) => {
  const url = new URL(to)
  url.searchParams.set(LINK_PARAM, LINK_VALUE)
  return callbackURL(url.toString())
}

/**
 * Managed Auth's answer in a return URL: the verifier, or AuthError (GOOGLE_NOT_LINKED,
 * GOOGLE_FAILED) for an error Google or Neon gave.
 */
export const readReturn = (params: URLSearchParams): GoogleReturn => {
  const verifier = params.get("neon_auth_session_verifier")
  if (verifier !== null && verifier !== "") return { verifier }
  const error = params.get("error")
  // No answer, or the learner said no on Google's page: as good as closing it.
  if (error === null || error === "access_denied") return null
  // Better Auth's codes when the address already has a password account it won't attach Google to.
  const notLinked = error === "account_not_linked" || error === "unable_to_link_account"
  throw new AuthError(notLinked ? "GOOGLE_NOT_LINKED" : "GOOGLE_FAILED", params.get("error_description") ?? error, 400)
}

/**
 * Managed Auth's answer after linking Google in Settings: `{ verifier }` on success,
 * `null` if the learner backed out, or AuthError (GOOGLE_EMAIL_MISMATCH,
 * GOOGLE_ALREADY_LINKED, GOOGLE_FAILED) if Google or Neon refused.
 */
export const readLinkReturn = (params: URLSearchParams): GoogleLinkReturn => {
  const error = params.get("error")
  if (error === "access_denied") return null
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
  const verifier = params.get("neon_auth_session_verifier")
  return { verifier: verifier !== null && verifier !== "" ? verifier : null }
}
