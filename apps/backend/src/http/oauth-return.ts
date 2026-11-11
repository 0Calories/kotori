import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { configuredWebOrigins, webOriginAllowed } from "./cors.ts"

const OAUTH_RETURN_PATH = "/auth/return"

/** The app's own URL scheme (app.json `scheme`), which iOS and Android hand back to Kotori. */
const APP_SCHEME = "kotori:"
/** Expo Go's scheme, for development builds run inside it. */
const EXPO_GO_SCHEME = "exp:"

/**
 * Where a Google sign-in may land: a web app origin the API already trusts with
 * credentials, or the native app's scheme (Expo Go's too, outside production).
 * Anything else is refused, so the verifier Neon appends never reaches another site.
 */
export const returnTarget = (
  to: string | undefined,
  allowedWebOrigin: (origin: string) => boolean,
  production: boolean
): URL | null => {
  if (to === undefined) return null
  let url: URL
  try {
    url = new URL(to)
  } catch {
    return null
  }
  if (url.protocol === APP_SCHEME) return url
  if (url.protocol === EXPO_GO_SCHEME) return production ? null : url
  if ((url.protocol === "https:" || url.protocol === "http:") && allowedWebOrigin(url.origin)) return url
  return null
}

/**
 * The page Managed Auth sends a learner back to after Google. Neon only redirects to
 * http(s) URLs on its trusted domains, so the app's sign-in names this route (on the
 * API's one trusted origin) as `callbackURL` and its real destination as `to`; the
 * route forwards Neon's query (`neon_auth_session_verifier`, or `error`) there. The
 * app then trades the verifier, with the challenge cookie `/sign-in/social` set, for
 * a session at `/api/auth/get-session`.
 */
export const OAuthReturnRoute = Layer.unwrap(
  Effect.gen(function* () {
    const production = process.env.NODE_ENV === "production"
    const allowed = webOriginAllowed(yield* configuredWebOrigins, production)
    return HttpRouter.add("GET", OAUTH_RETURN_PATH, (request) => {
      const query = new URL(request.url, "http://api.invalid").searchParams
      const target = returnTarget(query.get("to") ?? undefined, allowed, production)
      if (target === null) {
        return Effect.succeed(HttpServerResponse.text("This sign-in link can't be used here.", { status: 400 }))
      }
      for (const [name, value] of query) if (name !== "to") target.searchParams.set(name, value)
      return Effect.succeed(
        HttpServerResponse.redirect(target.toString(), {
          status: 302,
          headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" }
        })
      )
    })
  })
)
