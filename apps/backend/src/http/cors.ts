import { Config, Effect, Layer } from "effect"
import { HttpMiddleware, HttpRouter } from "effect/http"

/** Dev servers on this machine or the local network (where `pnpm dev:app` serves the web app). */
const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

/**
 * Matches an exact origin (`https://hellokotori.com`) or a single-label wildcard
 * subdomain (`https://kotori-*.vercel.app`, where `*` matches `[a-z0-9-]+`).
 */
const matchesOrigin = (pattern: string, origin: string): boolean => {
  if (!pattern.includes("*")) return pattern === origin
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[a-z0-9-]+")
  return new RegExp(`^${escaped}$`, "i").test(origin)
}

/**
 * Which browser origins may call the API with credentials: the configured web app
 * origins (including wildcard preview origins) and, outside production, local dev
 * servers. Credentials are what let the web app's session cookie (HttpOnly, kept by
 * the browser) reach `/api/auth/*`; native apps send no Origin and aren't subject to CORS.
 */
export const webOriginAllowed =
  (configured: ReadonlyArray<string>, production: boolean) =>
  (origin: string): boolean => {
    if (configured.some((pattern) => matchesOrigin(pattern, origin))) return true
    if (production) return false
    try {
      const url = new URL(origin)
      return url.protocol === "http:" && LOCAL_HOST.test(url.hostname)
    } catch {
      return false
    }
  }

/** Comma-separated origins from `KOTORI_WEB_ORIGINS`. */
export const configuredWebOrigins = Config.String("KOTORI_WEB_ORIGINS").pipe(
  Config.map((list) =>
    list
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean)
  ),
  Config.withDefault([])
)

/** CORS for the web app, from `KOTORI_WEB_ORIGINS` (comma-separated origins). */
export const CorsLive = Layer.unwrap(
  Effect.gen(function* () {
    const configured = yield* configuredWebOrigins
    const production = process.env.NODE_ENV === "production"
    return HttpRouter.middleware(
      HttpMiddleware.cors({
        allowedOrigins: webOriginAllowed(configured, production),
        credentials: true,
        maxAge: 86_400
      }),
      { global: true }
    )
  })
)
