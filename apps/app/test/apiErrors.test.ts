import {
  AiUnavailable,
  AskRefused,
  AuthUnavailable,
  Authorization,
  InvalidRequest,
  KotoriApi,
  NotFound,
  PendingApproval,
  RateLimited,
  Unauthorized
} from "@kotori/contracts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as HttpApiClient from "effect/http-api/HttpApiClient"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import { assert, describe, it } from "vitest"
import { ApiError, apiErrorMessage, failureContext, retryOffline, toApiError } from "../src/api/errors.ts"
import { strings } from "../src/i18n/strings.ts"

const request = HttpClientRequest.get("https://api.example.com/account/me?q=private").pipe(
  HttpClientRequest.bearerToken("secret-token")
)
const response = (status: number) => HttpClientResponse.fromWeb(request, new Response("{}", { status }))

const transport = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({ request, cause: new TypeError("Failed to fetch") })
})
// What `HttpApiClient` fails with for a status the contract doesn't declare (`statusOrElse`).
const undeclared500 = new HttpClientError.HttpClientError({
  reason: new HttpClientError.DecodeError({ request, response: response(500) })
})
// What it fails with for a declared error status whose body doesn't decode.
const undecodable404 = new HttpClientError.HttpClientError({
  reason: new HttpClientError.StatusCodeError({ request, response: response(404) })
})

describe("toApiError", () => {
  it("calls only a transport failure offline", () => {
    assert.strictEqual(toApiError(transport).tag, "Offline")
  })

  it("treats an undeclared 5xx as unexpected, not offline", () => {
    assert.strictEqual(toApiError(undeclared500).tag, "Unexpected")
  })

  it("treats a response that doesn't decode as unexpected", () => {
    assert.strictEqual(toApiError(undecodable404).tag, "Unexpected")
    const empty = new HttpClientError.HttpClientError({
      reason: new HttpClientError.EmptyBodyError({ request, response: response(200) })
    })
    assert.strictEqual(toApiError(empty).tag, "Unexpected")
  })

  it("keeps each tagged error from the contract", () => {
    assert.strictEqual(toApiError(new NotFound({ message: "x" })).tag, "NotFound")
    assert.strictEqual(toApiError(new Unauthorized({ message: "x" })).tag, "Unauthorized")
    assert.strictEqual(toApiError(new PendingApproval({ message: "x" })).tag, "PendingApproval")
    assert.strictEqual(toApiError(new InvalidRequest({ message: "x" })).tag, "InvalidRequest")
    assert.strictEqual(toApiError(new AiUnavailable({ message: "x" })).tag, "AiUnavailable")
  })

  it("treats Managed Auth being down as offline: the token is still good", () => {
    assert.strictEqual(toApiError(new AuthUnavailable({ message: "x" })).tag, "Offline")
  })

  it("keeps an ask refusal's reason and a rate limit's wait", () => {
    const refused = toApiError(new AskRefused({ reason: "keyboard" }))
    assert.strictEqual(refused.tag, "AskRefused")
    assert.strictEqual(refused.refusal, "keyboard")
    const before = Date.now()
    const limited = toApiError(new RateLimited({ message: "slow down", retryAfterSeconds: 30 }))
    assert.strictEqual(limited.tag, "RateLimited")
    assert.strictEqual(limited.retry?.afterSeconds, 30)
    assert.isAtLeast(limited.retry?.at ?? 0, before + 30_000)
  })

  it("treats anything else as unexpected", () => {
    assert.strictEqual(toApiError(new Error("boom")).tag, "Unexpected")
    assert.strictEqual(toApiError("boom").tag, "Unexpected")
    assert.strictEqual(toApiError({ _tag: "SchemaError", message: "Expected string" }).tag, "Unexpected")
    assert.strictEqual(toApiError(undefined).tag, "Unexpected")
  })
})

/** `/account/me` through the real typed client, against a fake transport that answers `respond`. */
const accountMe = (respond: (request: HttpClientRequest.HttpClientRequest) => Response | Error) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const api = yield* HttpApiClient.make(KotoriApi, { baseUrl: "https://api.example.com" })
      return yield* api.account.me()
    }).pipe(
      Effect.provide(HttpApiMiddleware.layerClient(Authorization, ({ next, request }) => next(request))),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          const answer = respond(request)
          return answer instanceof Error
            ? Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({ request, cause: answer })
                })
              )
            : Effect.succeed(HttpClientResponse.fromWeb(request, answer))
        })
      )
    )
  ).then((exit) => {
    if (Exit.isSuccess(exit)) return null
    const failure = Cause.squash(exit.cause)
    return { tag: toApiError(failure).tag, kind: failureContext(failure).kind }
  })

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("toApiError on what HttpApiClient actually fails with", () => {
  it("offline only when the request never got an answer", async () => {
    assert.deepStrictEqual(await accountMe(() => new TypeError("Failed to fetch")), {
      tag: "Offline",
      kind: "TransportError"
    })
  })

  it("unexpected for a 500 the contract doesn't declare", async () => {
    assert.deepStrictEqual(await accountMe(() => json(500, { error: "boom" })), {
      tag: "Unexpected",
      kind: "DecodeError"
    })
  })

  it("unexpected for a declared error whose body doesn't decode, and for a success that doesn't", async () => {
    assert.deepStrictEqual(await accountMe(() => json(401, { nope: true })), {
      tag: "Unexpected",
      kind: "StatusCodeError"
    })
    assert.deepStrictEqual(await accountMe(() => json(200, { nope: true })), {
      tag: "Unexpected",
      kind: "SchemaError"
    })
  })

  it("the contract's tagged error when it decodes", async () => {
    const body = { _tag: "Unauthorized", message: "Sign in again." }
    assert.deepStrictEqual(await accountMe(() => json(401, body)), { tag: "Unauthorized", kind: "Unauthorized" })
  })
})

describe("failureContext", () => {
  it("names the reason, method, path and status, and nothing from the request's headers or query", () => {
    const context = failureContext(undeclared500)
    assert.deepStrictEqual(context, { kind: "DecodeError", method: "GET", path: "/account/me", status: 500 })
    assert.notInclude(JSON.stringify(context), "secret-token")
    assert.deepStrictEqual(failureContext(transport), { kind: "TransportError", method: "GET", path: "/account/me" })
  })

  it("keeps a decode failure's description, and copes with anything", () => {
    assert.deepStrictEqual(failureContext(new NotFound({ message: "gone" })), { kind: "NotFound", detail: "gone" })
    assert.deepStrictEqual(failureContext("boom"), { kind: "string" })
  })
})

describe("retryOffline", () => {
  it("retries a dropped connection twice", () => {
    const offline = new ApiError("Offline", "")
    assert.isTrue(retryOffline(0, offline))
    assert.isTrue(retryOffline(1, offline))
    assert.isFalse(retryOffline(2, offline))
  })

  it("doesn't retry what can't go differently", () => {
    for (const tag of ["NotFound", "InvalidRequest", "PendingApproval", "AskRefused", "Unexpected"] as const) {
      assert.isFalse(retryOffline(0, new ApiError(tag, "")), tag)
    }
    assert.isFalse(retryOffline(0, new Error("boom")))
  })
})

describe("apiErrorMessage", () => {
  it("words every tag from the app's own strings, never the server's message", () => {
    const server = "Coaching isn't set up on this server yet (missing Anthropic credentials)."
    for (const t of [strings.en, strings.ja]) {
      for (const tag of [
        "NotFound",
        "Unauthorized",
        "PendingApproval",
        "InvalidRequest",
        "AskRefused",
        "AiUnavailable",
        "RateLimited",
        "Offline",
        "Unexpected"
      ] as const) {
        const message = apiErrorMessage(t, new ApiError(tag, server))
        assert.notStrictEqual(message, server)
        assert.isAbove(message.length, 0)
      }
      assert.strictEqual(apiErrorMessage(t, new ApiError("Unexpected", server)), t.common.errors.trouble)
      assert.strictEqual(apiErrorMessage(t, new Error(server)), t.common.somethingWrong)
    }
  })

  it("words a refusal by its reason, and a rate limit by its wait", () => {
    const t = strings.en
    assert.strictEqual(apiErrorMessage(t, new ApiError("AskRefused", "", "keyboard")), t.dictionary.askRefused.keyboard)
    const wait = (seconds: number) =>
      new ApiError("RateLimited", "", null, { afterSeconds: seconds, at: Date.now() + seconds * 1000 })
    assert.strictEqual(apiErrorMessage(t, wait(30)), t.common.errors.rateLimited(1))
    assert.strictEqual(apiErrorMessage(t, wait(600)), t.common.errors.rateLimited(10))
    assert.include(apiErrorMessage(strings.ja, wait(600)), "10分")
  })
})
