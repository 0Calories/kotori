import { AuthError } from "./error.ts"

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"

export const VERIFIER_PARAM = "neon_auth_session_verifier"

export const NATIVE_CALLBACK_PATH = "auth/callback"

export type GoogleReturn = { readonly verifier: string } | "cancelled" | null

export type GoogleLinkReturn =
  | { readonly kind: "id_token"; readonly idToken: string; readonly nonce: string }
  | { readonly kind: "verifier"; readonly verifier: string | null }
  | "cancelled"
  | null

export interface PendingGoogleLink {
  readonly state: string
  readonly nonce: string
}

export const RETURN_PARAMS = [VERIFIER_PARAM, "error", "error_description"] as const

export const ID_TOKEN_RETURN_PARAMS = ["id_token", "state", "error", "error_description"] as const

export const LINK_PARAM = "google"
export const LINK_VALUE = "linked"

export const RETURN_URL_PARAMS: ReadonlyArray<string> = [...new Set([...RETURN_PARAMS, ...ID_TOKEN_RETURN_PARAMS])]

export interface CapturedReturn {
  readonly query: URLSearchParams
  readonly hash: URLSearchParams | null
  readonly cleanUrl: string | null
}

export const captureReturnUrl = (href: string): CapturedReturn => {
  const url = new URL(href)
  const query = new URLSearchParams()
  for (const key of RETURN_URL_PARAMS) {
    for (const value of url.searchParams.getAll(key)) query.append(key, value)
    url.searchParams.delete(key)
  }
  if (url.searchParams.get(LINK_PARAM) === LINK_VALUE) {
    query.set(LINK_PARAM, LINK_VALUE)
    url.searchParams.delete(LINK_PARAM)
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""))
  const hash = ID_TOKEN_RETURN_PARAMS.some((name) => fragment.has(name)) ? fragment : null
  if (hash !== null) url.hash = ""
  const changed = query.toString() !== "" || hash !== null
  return { query, hash, cleanUrl: changed ? url.toString() : null }
}

const REDACTED = "[Filtered]"

// A return parameter after `?`, `#`, `&` or `;`, also percent-encoded inside another URL's query.
const RETURN_PARAM_PATTERN = new RegExp(
  `([?#&;]|%3F|%23|%26)(${RETURN_URL_PARAMS.join("|")})(=|%3D)(?:(?!%26|%23)[^&#\\s"'<>])*`,
  "gi"
)

export const redactReturnParams = (text: string): string =>
  text.replace(
    RETURN_PARAM_PATTERN,
    (_match, before: string, name: string, equals: string) => `${before}${name}${equals}${REDACTED}`
  )

// Only credential keys: `error` and `state` are ordinary field names in Sentry payloads.
export const isReturnSecretKey = (key: string): boolean => key === VERIFIER_PARAM || key === "id_token"

export const LINK_STORAGE_KEY = "kotori.googleLink"

export const parsePendingLink = (raw: string | null): PendingGoogleLink | null => {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const { state, nonce } = parsed as Record<string, unknown>
    return typeof state === "string" && typeof nonce === "string" ? { state, nonce } : null
  } catch {
    return null
  }
}

export const randomOAuthToken = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export const callbackURL = (apiUrl: string, to: string) => `${apiUrl}/auth/return?to=${encodeURIComponent(to)}`

export const linkCallbackURL = (apiUrl: string, to: string) => {
  const url = new URL(to)
  url.searchParams.set(LINK_PARAM, LINK_VALUE)
  return callbackURL(apiUrl, url.toString())
}

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

// Neon Managed Auth wraps `/sign-in/social` with an `/init` state-cookie hop, but not `/link-social`, so web linking requests an OIDC `id_token` directly.
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

export const isNativeAuthCallback = (path: string): boolean => {
  const stripped = (path.split(/[?#]/, 1)[0] ?? "").replace(/^([a-z][a-z0-9+.-]*):\/+/i, "$1://")
  return (
    stripped === `/${NATIVE_CALLBACK_PATH}` ||
    stripped.endsWith(`://${NATIVE_CALLBACK_PATH}`) ||
    stripped.endsWith(`/--/${NATIVE_CALLBACK_PATH}`)
  )
}

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
