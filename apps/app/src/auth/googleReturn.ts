import { apiUrl } from "../api/config.ts"
import { AuthError } from "./client.ts"

/** What came back from Google: a verifier to trade for a session, or nothing (the learner backed out). */
export type GoogleReturn = { readonly verifier: string } | null

/** The query parameters Managed Auth adds to the return URL. */
export const RETURN_PARAMS = ["neon_auth_session_verifier", "error", "error_description"] as const

/** The API's `/auth/return`, which forwards Managed Auth's answer on to `to`. */
export const callbackURL = (to: string) => `${apiUrl}/auth/return?to=${encodeURIComponent(to)}`

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
