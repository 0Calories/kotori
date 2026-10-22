import { Config, Effect, Layer, Logger } from "effect"

/**
 * `NODE_ENV=production`, as set on Railway. Production refuses to start without
 * its secrets and logs JSON lines; everything else is tuned for a laptop.
 */
export const isProduction = Config.String("NODE_ENV").pipe(
  Config.withDefault("development"),
  Config.map((env) => env === "production")
)

/** JSON lines in production (Railway's log viewer parses them), a pretty console otherwise. */
export const LoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const production = yield* isProduction
    return Logger.layer([production ? Logger.consoleJson : Logger.consolePretty()])
  })
)
