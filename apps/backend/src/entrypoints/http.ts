import { NodeHttpClient, NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node"
import { KotoriApi } from "@kotori/contracts"
import { Config, Effect, Layer, Logger } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { createServer } from "node:http"
import { AudioRoute } from "../http/audio.ts"
import { AuthorizationLive } from "../http/Authorization.ts"
import { CorsLive } from "../http/cors.ts"
import { AllHandlers } from "../http/handlers.ts"
import { AuthRoute } from "../http/neon-auth.ts"
import { OAuthReturnRoute } from "../http/oauth-return.ts"
import { WebhooksRoute } from "../http/webhooks.ts"
import { AppLive } from "../runtime/HttpLayers.ts"
import { loadDotEnv } from "../runtime/Paths.ts"
import { loggerLayer, SentryLive } from "../runtime/Sentry.ts"

loadDotEnv()

const ApiRoutes = HttpApiBuilder.layer(KotoriApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(AllHandlers),
  Layer.provide(AuthorizationLive)
)

const Routes = Layer.mergeAll(
  ApiRoutes,
  AudioRoute,
  AuthRoute,
  OAuthReturnRoute,
  WebhooksRoute,
  HttpApiScalar.layer(KotoriApi, { path: "/docs" }),
  CorsLive
)

const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("KOTORI_PORT").pipe(
      Config.orElse(() => Config.Port("PORT")),
      Config.withDefault(4000)
    )
    return HttpRouter.serve(Routes).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port, host: "0.0.0.0" })))
  })
)

const LoggerLive = loggerLayer(process.env.NODE_ENV === "production" ? [Logger.consoleJson] : [])

Layer.launch(ServerLive).pipe(
  Effect.provide(AppLive),
  Effect.provide(NodeHttpClient.layerUndici),
  Effect.provide(NodeServices.layer),
  Effect.provide(LoggerLive),
  Effect.provide(SentryLive("api")),
  NodeRuntime.runMain
)
