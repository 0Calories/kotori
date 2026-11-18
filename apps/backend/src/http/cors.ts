import { Config, Effect, Layer } from "effect"
import { HttpMiddleware, HttpRouter } from "effect/http"

const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

const matchesOrigin = (pattern: string, origin: string): boolean => {
  if (!pattern.includes("*")) return pattern === origin
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")
  return new RegExp(`^${escaped}$`, "i").test(origin)
}

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

export const configuredWebOrigins = Config.String("KOTORI_WEB_ORIGINS").pipe(
  Config.map((list) =>
    list
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean)
  ),
  Config.withDefault([])
)

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
