import { AuthError, managedAuth } from "./client.ts"
import { transport } from "./transport"

const MARGIN_MS = 60_000

let current: { readonly token: string; readonly expiresAt: number } | null = null
let minting: Promise<string | null> | null = null
const signedOut = new Set<() => void>()

const expiresAt = (jwt: string) => {
  try {
    const part = (jwt.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")
    const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")))
    const exp = typeof claims === "object" && claims !== null && "exp" in claims ? claims.exp : undefined
    if (typeof exp === "number") return exp * 1000
  } catch {}
  return Date.now() + 5 * 60_000
}

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

export const tokens = {
  current: (): Promise<string | null> =>
    current !== null && current.expiresAt - Date.now() > MARGIN_MS ? Promise.resolve(current.token) : tokens.refresh(),
  refresh: (): Promise<string | null> => {
    minting ??= mint().finally(() => {
      minting = null
    })
    return minting
  },
  clear: () => {
    current = null
  },
  end,
  onSignedOut: (listener: () => void) => {
    signedOut.add(listener)
    return () => {
      signedOut.delete(listener)
    }
  }
}
