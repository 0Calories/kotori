import { apiUrl } from "../api/config.ts"
import { transport } from "./transport"

/**
 * A Managed Auth refusal, by Better Auth's error code (INVALID_EMAIL_OR_PASSWORD,
 * USER_ALREADY_EXISTS, INVALID_OTP…), or OFFLINE when it, or the API's proxy to it,
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
  /** A 15-minute EdDSA JWT for the session (the JWT plugin's `GET /token`). */
  token: () => request<{ readonly token: string }>("GET", "/token"),
  /** Emails a verification code (Email OTP); Kotori's webhook sends it in the learner's language. */
  sendVerificationCode: (email: string) =>
    request<unknown>("POST", "/email-otp/send-verification-otp", { email, type: "email-verification" }),
  verifyEmail: (email: string, otp: string) => request<unknown>("POST", "/email-otp/verify-email", { email, otp })
}
