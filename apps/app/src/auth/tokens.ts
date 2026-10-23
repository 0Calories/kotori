import { AuthError, managedAuth } from "./client.ts"
import { transport } from "./transport"

/** Mint a new JWT this long before the current one expires, so no request carries one about to lapse. */
const MARGIN_MS = 60_000

let current: { readonly token: string; readonly expiresAt: number } | null = null
let minting: Promise<string | null> | null = null
const signedOut = new Set<() => void>()

/** The JWT's `exp`, read without verifying (the API does that); a short guess if it can't be read. */
const expiresAt = (jwt: string) => {
  try {
    const part = (jwt.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")
    const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")))
    const exp = typeof claims === "object" && claims !== null && "exp" in claims ? claims.exp : undefined
    if (typeof exp === "number") return exp * 1000
  } catch {}
  return Date.now() + 5 * 60_000
}

/** The session is over: forget it (on the web, the sign-out clears the HttpOnly cookie) and tell the app. */
const end = async () => {
  current = null
  await managedAuth.signOut().catch(() => {})
  await transport.forget()
  for (const listener of signedOut) listener()
}

const mint = async (): Promise<string | null> => {
  if (!(await transport.hasCredential())) {
    current = null
    return null
  }
  try {
    const { token } = await managedAuth.token()
    current = { token, expiresAt: expiresAt(token) }
    return token
  } catch (error) {
    // 401: the session is gone (signed out elsewhere, revoked, deleted). Anything else keeps it.
    if (!(error instanceof AuthError) || error.status !== 401) throw error
    await end()
    return null
  }
}

/**
 * The API's credential: Managed Auth's 15-minute JWTs, minted from the session
 * (`GET /api/auth/token`) and held in memory only. The session itself is the
 * long-lived credential (see `transport`).
 */
export const tokens = {
  /** A JWT good for at least another minute, or null when signed out. Throws AuthError("OFFLINE"). */
  current: (): Promise<string | null> =>
    current !== null && current.expiresAt - Date.now() > MARGIN_MS ? Promise.resolve(current.token) : tokens.refresh(),
  /** A freshly minted JWT, after the API refused one; concurrent callers share the request. */
  refresh: (): Promise<string | null> => {
    minting ??= mint().finally(() => {
      minting = null
    })
    return minting
  },
  clear: () => {
    current = null
  },
  /** The API refused even a fresh JWT: the session was revoked or deleted. */
  end,
  /** Called when the session turns out to be gone, so the app can show the sign-in screen. */
  onSignedOut: (listener: () => void) => {
    signedOut.add(listener)
    return () => {
      signedOut.delete(listener)
    }
  }
}
