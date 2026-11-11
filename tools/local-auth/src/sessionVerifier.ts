import type { BetterAuthPlugin } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { expireCookie, setSessionCookie } from "better-auth/cookies"
import { randomUUID } from "node:crypto"

/** The query parameter Neon appends to `callbackURL` after a social sign-in. */
const VERIFIER_PARAM = "neon_auth_session_verifier"

/** How long a challenge (sign-in → callback) and a verifier (callback → exchange) stay good. */
const TTL_MS = 10 * 60_000

/**
 * Managed Auth's social sign-in handoff, which plain Better Auth doesn't have. The
 * provider's callback lands on the auth server's own origin, so the session cookie it
 * would set there never reaches the API's proxy. Instead, as Neon does:
 *
 * 1. `POST /sign-in/social` also sets a `session_challenge` cookie, tied to the OAuth state.
 * 2. `/callback/:id` appends a one-time `neon_auth_session_verifier` to the redirect.
 * 3. `GET /get-session?neon_auth_session_verifier=…`, sent with the challenge cookie,
 *    sets the session cookie and answers the session.
 *
 * Kept in memory: a restart in the middle of a sign-in just means starting it again.
 */
export const sessionVerifier = (): BetterAuthPlugin => {
  const challenges = new Map<string, { readonly challenge: string; readonly expiresAt: number }>()
  const verifiers = new Map<
    string,
    { readonly challenge: string; readonly sessionToken: string; readonly expiresAt: number }
  >()
  const sweep = (now: number) => {
    for (const [key, value] of challenges) if (value.expiresAt < now) challenges.delete(key)
    for (const [key, value] of verifiers) if (value.expiresAt < now) verifiers.delete(key)
  }

  return {
    id: "neon-session-verifier",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/get-session" && typeof context.query?.[VERIFIER_PARAM] === "string",
          handler: createAuthMiddleware(async (ctx) => {
            const now = Date.now()
            sweep(now)
            const verifier = String(ctx.query?.[VERIFIER_PARAM])
            const pending = verifiers.get(verifier)
            verifiers.delete(verifier)
            const cookie = ctx.context.createAuthCookie("session_challenge")
            if (pending === undefined || ctx.getCookie(cookie.name) !== pending.challenge) {
              return ctx.json(null, { status: 401 })
            }
            const session = await ctx.context.internalAdapter.findSession(pending.sessionToken)
            if (session === null) return ctx.json(null, { status: 401 })
            await setSessionCookie(ctx, session)
            expireCookie(ctx, cookie)
            return ctx.json(session)
          })
        }
      ],
      after: [
        {
          matcher: (context) => context.path === "/sign-in/social",
          handler: createAuthMiddleware(async (ctx) => {
            const now = Date.now()
            sweep(now)
            const returned = ctx.context.returned
            const url =
              typeof returned === "object" && returned !== null && "url" in returned ? returned.url : undefined
            if (typeof url !== "string") return
            const state = new URL(url).searchParams.get("state")
            if (state === null) return
            const challenge = randomUUID()
            challenges.set(state, { challenge, expiresAt: now + TTL_MS })
            const cookie = ctx.context.createAuthCookie("session_challenge", { maxAge: TTL_MS / 1000 })
            ctx.setCookie(cookie.name, challenge, cookie.attributes)
          })
        },
        {
          matcher: (context) => context.path === "/callback/:id",
          handler: createAuthMiddleware(async (ctx) => {
            const now = Date.now()
            sweep(now)
            const location = ctx.context.responseHeaders?.get("location")
            const session = ctx.context.newSession
            const state = ctx.query?.state ?? (ctx.body as { state?: unknown } | undefined)?.state
            const pending = typeof state === "string" ? challenges.get(state) : undefined
            if (typeof state === "string") challenges.delete(state)
            if (!location || session === null || pending === undefined || pending.expiresAt < now) return
            const verifier = randomUUID()
            verifiers.set(verifier, {
              challenge: pending.challenge,
              sessionToken: session.session.token,
              expiresAt: now + TTL_MS
            })
            const next = new URL(location)
            next.searchParams.set(VERIFIER_PARAM, verifier)
            ctx.setHeader("location", next.toString())
          })
        }
      ]
    }
  }
}
