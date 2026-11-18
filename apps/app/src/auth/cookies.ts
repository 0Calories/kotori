export type SessionCookies = Readonly<Record<string, string>>

const matchesCookie = (name: string, target: string) => name === target || name.endsWith(`.${target}`)

const CHALLENGES = ["session_challenge", "session_challange"] // Neon still accepts the misspelling.
const isSessionToken = (name: string) => matchesCookie(name, "session_token")
const isChallengeCookie = (name: string) => CHALLENGES.some((kept) => matchesCookie(name, kept))

const isSessionCookie = (name: string) => isSessionToken(name) || isChallengeCookie(name)

// React Native joins multiple Set-Cookie headers with commas, including commas inside Expires dates.
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

export const hasSessionToken = (stored: SessionCookies) => Object.keys(stored).some(isSessionToken)

export const dropChallenges = (stored: SessionCookies): SessionCookies => {
  if (!Object.keys(stored).some(isChallengeCookie)) return stored
  return Object.fromEntries(Object.entries(stored).filter(([name]) => !isChallengeCookie(name)))
}

export const cookieHeader = (stored: SessionCookies) =>
  Object.entries(stored)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
