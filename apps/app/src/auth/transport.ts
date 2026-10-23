import { storage } from "../session/storage"
import { applySetCookie, cookieHeader, type SessionCookies } from "./cookies.ts"

const KEY = "kotori.session"

let cached: SessionCookies | null = null

const load = async (): Promise<SessionCookies> => {
  if (cached !== null) return cached
  const raw = await storage.get(KEY)
  cached = raw === null ? {} : (JSON.parse(raw) as SessionCookies)
  return cached
}

const save = async (cookies: SessionCookies) => {
  cached = cookies
  if (Object.keys(cookies).length === 0) await storage.remove(KEY)
  else await storage.set(KEY, JSON.stringify(cookies))
}

/**
 * Requests to `/api/auth/*` on iOS and Android: the session cookie lives in the
 * Keychain/Keystore and goes out as a `Cookie` header. `credentials: "omit"` keeps
 * the OS cookie jar out of it, so what is stored is the only credential there is.
 */
export const transport = {
  /** Whether this device holds a session to mint JWTs from. */
  hasCredential: async () => Object.keys(await load()).length > 0,
  fetch: async (url: string, init: RequestInit): Promise<Response> => {
    const stored = await load()
    const headers = new Headers(init.headers)
    if (Object.keys(stored).length > 0) headers.set("cookie", cookieHeader(stored))
    const response = await fetch(url, { ...init, headers, credentials: "omit" })
    const next = applySetCookie(stored, response.headers.get("set-cookie"))
    if (next !== stored) await save(next)
    return response
  },
  forget: () => save({})
}
