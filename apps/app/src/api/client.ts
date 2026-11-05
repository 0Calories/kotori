import {
  AskRefused,
  type AskRefusal,
  Authorization,
  type Entry,
  type EntryId,
  KotoriApi,
  RateLimited
} from "@kotori/contracts"
import { fetch as streamingFetch } from "expo/fetch"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Duration from "effect/Duration"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Predicate from "effect/Predicate"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import { tokens } from "../auth/tokens.ts"
import { apiUrl } from "./config.ts"

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

export type ApiErrorTag =
  | "NotFound"
  | "Unauthorized"
  | "PendingApproval"
  | "InvalidRequest"
  | "AskRefused"
  | "AiUnavailable"
  | "RateLimited"
  | "Offline"
  | "Unexpected"

export class ApiError extends Error {
  constructor(
    readonly tag: ApiErrorTag,
    message: string,
    /** Why Ask Kotori turned the query away, for an `AskRefused`: a code the app words. */
    readonly refusal: AskRefusal | null = null,
    /** For a `RateLimited`: how long the server said to wait, and when that wait ends (epoch ms). */
    readonly retry: { readonly afterSeconds: number; readonly at: number } | null = null
  ) {
    super(message)
  }
}

const KNOWN = new Set<string>([
  "NotFound",
  "Unauthorized",
  "PendingApproval",
  "InvalidRequest",
  "AiUnavailable",
  "RateLimited"
])

const toApiError = (error: unknown): ApiError => {
  if (error instanceof AskRefused) return new ApiError("AskRefused", "", error.reason)
  if (error instanceof RateLimited) {
    const retry = { afterSeconds: error.retryAfterSeconds, at: Date.now() + error.retryAfterSeconds * 1000 }
    return new ApiError("RateLimited", error.message, null, retry)
  }
  if (Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)) {
    const message = Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : ""
    if (KNOWN.has(error._tag)) return new ApiError(error._tag as ApiErrorTag, message)
    if (error._tag === "HttpClientError") return new ApiError("Offline", message)
    // Managed Auth is down: the stored token is still good, so this is not a sign-out.
    if (error._tag === "AuthUnavailable") return new ApiError("Offline", message)
  }
  return new ApiError("Unexpected", error instanceof Error ? error.message : String(error))
}

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
  throw toApiError(Cause.squash(exit.cause))
}

/** Waits before reconnecting a dropped (or finished, but still waiting) stream: 1 s doubling, at most 30 s. */
const RECONNECT = Schedule.min([Schedule.exponential(Duration.seconds(1)), Schedule.spaced(Duration.seconds(30))])

/** Stands for a stream that ended while the entry was still waiting, so it reconnects. */
class StillWaiting {
  readonly _tag = "StillWaiting"
}

/**
 * Follows an entry's live updates, handing each version of the entry to `onEntry`, until
 * `settled` says it's all there or the returned function stops it. A stream that drops (or ends
 * after its few minutes) reconnects after a pause, and every connection starts with the entry
 * as it stands, so nothing missed in between is lost. Not a sign-out on a refused JWT: the next
 * connection mints a fresh one, and regular requests handle a session that's really gone.
 *
 * Streams through `expo/fetch`, whose responses stream on iOS and Android (React Native's own
 * `fetch` buffers them) and which is the browser's `fetch` on the web. The JWT travels in the
 * `Authorization` header as for every other call, which `EventSource` couldn't send.
 */
export const followEntry = (
  id: EntryId,
  onEntry: (entry: Entry) => void,
  settled: (entry: Entry) => boolean
): (() => void) => {
  let done = false
  let refresh = false
  const connection = Effect.gen(function* () {
    const api = yield* Api
    token = yield* Effect.tryPromise(() => (refresh ? tokens.refresh() : tokens.current()))
    refresh = false
    const updates = yield* api.dictionary.updates({ params: { id } })
    yield* Stream.runForEach(updates, (update) =>
      Effect.sync(() => {
        if (update._tag !== "Entry") return
        done = settled(update.entry)
        onEntry(update.entry)
      })
    )
    if (!done) return yield* Effect.fail(new StillWaiting())
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (Predicate.isTagged(error, "Unauthorized")) refresh = true
      })
    )
  )
  const fiber = runtime.runFork(
    connection.pipe(
      Effect.retry({ schedule: RECONNECT, while: () => !done }),
      Effect.ignore,
      Effect.provideService(FetchHttpClient.Fetch, streamingFetch as unknown as typeof globalThis.fetch),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false)
    )
  )
  return () => {
    done = true
    fiber.interruptUnsafe()
  }
}
