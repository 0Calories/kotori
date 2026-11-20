import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { configuredWebOrigins, webOriginAllowed } from "./cors.ts"

const OAUTH_RETURN_PATH = "/auth/return"

const APP_SCHEME = "kotori:"
const EXPO_GO_SCHEME = "exp:"

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

// Neon Managed Auth only redirects to http(s) URLs on trusted domains, so OAuth callbacks bounce through this route to reach custom app schemes and preview origins.
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
