import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node"
import { Auth } from "@kotori/auth"
import { loadDotEnv } from "@kotori/db"
import { KotoriApi } from "@kotori/domain"
import { Config, Effect, Layer, Logger } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { createServer } from "node:http"
import { AudioRoute } from "./http/audio.ts"
import { AuthorizationLive } from "./http/Authorization.ts"
import { BetterAuthRoute } from "./http/better-auth.ts"
import { AllHandlers } from "./http/handlers.ts"
import { AppLive } from "./layers.ts"

loadDotEnv()

const ApiRoutes = HttpApiBuilder.layer(KotoriApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(AllHandlers),
  Layer.provide(AuthorizationLive)
)

const Routes = Layer.mergeAll(
  ApiRoutes,
  AudioRoute,
  BetterAuthRoute,
  HttpApiScalar.layer(KotoriApi, { path: "/docs" }),
  HttpRouter.cors({ maxAge: 86_400 })
)

const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    // Hosts inject PORT (Fly sets it in fly.toml); KOTORI_PORT still wins for a local override.
    const port = yield* Config.Port("KOTORI_PORT").pipe(
      Config.orElse(() => Config.Port("PORT")),
      Config.withDefault(4000)
    )
    // Listen on all interfaces so phones on the same network can reach a dev server.
    return HttpRouter.serve(Routes).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port, host: "0.0.0.0" })))
  })
)

// Railway's log viewer parses JSON lines; development keeps the pretty logger.
const LoggerLive = process.env.NODE_ENV === "production" ? Logger.layer([Logger.consoleJson]) : Layer.empty

Layer.launch(ServerLive).pipe(
  Effect.provide(Auth.layer.pipe(Layer.provideMerge(AppLive))),
  Effect.provide(NodeHttpClient.layerUndici),
  Effect.provide(NodeServices.layer),
  Effect.provide(LoggerLive),
  NodeRuntime.runMain
)
