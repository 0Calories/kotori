/**
 * The session cookie a native app keeps by hand. Managed Auth's credential is an
 * HttpOnly cookie (`__Secure-neonauth.session_token`); a browser keeps it on its own,
 * but on iOS and Android the app reads it from `Set-Cookie` and sends it back as a
 * `Cookie` header, only to `/api/auth/*`, to mint the short-lived JWT the API takes.
 */
export type SessionCookies = Readonly<Record<string, string>>

/** Better Auth's session cookie, whatever its prefix; the cookie cache and the rest aren't needed to mint a JWT. */
const isSessionCookie = (name: string) => name === "session_token" || name.endsWith(".session_token")

/**
 * Splits a `Set-Cookie` header that React Native has joined with commas. A comma
 * only starts a new cookie when a `name=` follows, so `Expires` dates stay whole.
 */
export const splitSetCookie = (header: string) =>
  header
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.length > 0)

const expired = (attributes: ReadonlyArray<string>, now: number) =>
  attributes.some((attribute) => {
    const [key = "", value = ""] = attribute.split("=").map((part) => part.trim())
    if (key.toLowerCase() === "max-age") return Number(value) <= 0
    if (key.toLowerCase() === "expires") return Date.parse(value) <= now
    return false
  })

/** The stored cookies after a response: session cookies it set are kept, ones it cleared are dropped. */
export const applySetCookie = (stored: SessionCookies, header: string | null, now = Date.now()): SessionCookies => {
  if (header === null || header === "") return stored
  let next = stored
  for (const cookie of splitSetCookie(header)) {
    const [pair = "", ...attributes] = cookie.split(";")
    const separator = pair.indexOf("=")
    if (separator <= 0) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (!isSessionCookie(name)) continue
    if (value === "" || expired(attributes, now)) {
      if (name in next) next = Object.fromEntries(Object.entries(next).filter(([key]) => key !== name))
    } else if (next[name] !== value) {
      next = { ...next, [name]: value }
    }
  }
  return next
}

export const cookieHeader = (stored: SessionCookies) =>
  Object.entries(stored)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
