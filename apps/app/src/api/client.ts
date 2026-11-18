import { Authorization, KotoriApi } from "@kotori/contracts"
import * as Sentry from "@sentry/react-native"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import { tokens } from "../auth/tokens.ts"
import { apiUrl } from "./config.ts"
import { ApiError, failureContext, toApiError } from "./errors.ts"

export { ApiError } from "./errors.ts"

/** The JWT sent with requests; `call` keeps it fresh. */
let token: string | null = null

class Api extends Context.Service<Api, HttpApiClient.ForApi<typeof KotoriApi>>()("@kotori/app/Api") {}

const AuthorizationClient = HttpApiMiddleware.layerClient(Authorization, ({ next, request }) =>
  next(token === null ? request : HttpClientRequest.bearerToken(request, token))
)

const ApiLive = Layer.effect(
  Api,
  HttpApiClient.make(KotoriApi, {
    transformClient: (client) => client.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(apiUrl)))
  })
).pipe(Layer.provide(AuthorizationClient), Layer.provide(FetchHttpClient.layer))

const runtime = ManagedRuntime.make(ApiLive)

/** A JWT from Managed Auth; it being unreachable is offline, as for the API. */
const bearer = async (get: () => Promise<string | null>) => {
  try {
    return await get()
  } catch (error) {
    throw new ApiError("Offline", error instanceof Error ? error.message : String(error))
  }
}

const run = <A, E>(request: (api: Api["Service"]) => Effect.Effect<A, E>) =>
  runtime.runPromiseExit(
    Effect.gen(function* () {
      const api = yield* Api
      return yield* request(api)
    }).pipe(
      // No tracing backend in the app, and trace headers would need extra CORS allowances.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false)
    )
  )

/**
 * Runs a typed API call as a promise, for React Query. Failures become `ApiError`s.
 * The JWT is minted or renewed first when needed; if the API still refuses it, one
 * fresh JWT is tried before the 401 stands (which then signs the learner out).
 */
export const call = async <A, E>(request: (api: Api["Service"]) => Effect.Effect<A, E>): Promise<A> => {
  token = await bearer(tokens.current)
  let exit = await run(request)
  if (Exit.isFailure(exit) && token !== null && toApiError(Cause.squash(exit.cause)).tag === "Unauthorized") {
    token = await bearer(tokens.refresh)
    if (token !== null) exit = await run(request)
    // Managed Auth still minted one, but the API knows the session is gone (revoked, deleted).
    if (Exit.isFailure(exit) && toApiError(Cause.squash(exit.cause)).tag === "Unauthorized") await tokens.end()
  }
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.squash(exit.cause)
  const error = toApiError(failure)
  if (error.tag === "Unexpected") report(failure)
  throw error
}

/** An `Unexpected` failure is a bug or a wire-shape mismatch (the API deploys first), so Sentry hears of it. */
const report = (failure: unknown) => {
  const { kind, method, path, status, detail } = failureContext(failure)
  const where = [method, path, status].filter((part) => part !== undefined).join(" ")
  Sentry.captureException(new Error(`API call failed unexpectedly: ${kind}${where ? ` (${where})` : ""}`), {
    tags: { "api.failure": kind, ...(status === undefined ? {} : { "api.status": String(status) }) },
    extra: { method, path, status, detail }
  })
}
