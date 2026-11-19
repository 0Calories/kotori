import { AskRefused, type AskRefusal, RateLimited } from "@kotori/contracts"
import * as HttpClientError from "effect/http/HttpClientError"
import * as Predicate from "effect/Predicate"
import type { Strings } from "../i18n/strings.ts"

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
    readonly refusal: AskRefusal | null = null,
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

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof AskRefused) return new ApiError("AskRefused", "", error.reason)
  if (error instanceof RateLimited) {
    const retry = { afterSeconds: error.retryAfterSeconds, at: Date.now() + error.retryAfterSeconds * 1000 }
    return new ApiError("RateLimited", error.message, null, retry)
  }
  if (HttpClientError.isHttpClientError(error)) {
    // HttpApiClient surfaces undeclared status codes (such as an unhandled 500) as DecodeError, not TransportError.
    return new ApiError(error.reason._tag === "TransportError" ? "Offline" : "Unexpected", error.message)
  }
  if (Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)) {
    const message = Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : ""
    if (KNOWN.has(error._tag)) return new ApiError(error._tag as ApiErrorTag, message)
    // Managed Auth is down: the stored token is still good, so this is not a sign-out.
    if (error._tag === "AuthUnavailable") return new ApiError("Offline", message)
  }
  return new ApiError("Unexpected", error instanceof Error ? error.message : String(error))
}

export const failureContext = (
  error: unknown
): {
  readonly kind: string
  readonly method?: string
  readonly path?: string
  readonly status?: number
  readonly detail?: string
} => {
  if (HttpClientError.isHttpClientError(error)) {
    const { request } = error.reason
    const status = error.response?.status
    return {
      kind: error.reason._tag,
      method: request.method,
      path: request.url.replace(/^[a-z]+:\/\/[^/]+/i, "").replace(/[?#].*$/, "") || "/",
      ...(status === undefined ? {} : { status })
    }
  }
  if (Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag)) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : undefined
    return { kind: error._tag, ...(detail ? { detail } : {}) }
  }
  return { kind: error instanceof Error ? error.name : typeof error }
}

export const retryOffline = (failureCount: number, error: unknown) =>
  failureCount < 2 && error instanceof ApiError && error.tag === "Offline"

export const apiErrorMessage = (t: Strings, error: unknown): string => {
  if (!(error instanceof ApiError)) return t.common.somethingWrong
  switch (error.tag) {
    case "Offline":
      return t.common.offline
    case "NotFound":
      return t.common.errors.notFound
    case "Unauthorized":
      return t.common.errors.signedOut
    case "PendingApproval":
      return t.common.errors.pendingApproval
    case "InvalidRequest":
      return t.common.errors.invalid
    case "AskRefused":
      return error.refusal === null ? t.common.somethingWrong : t.dictionary.askRefused[error.refusal]
    case "AiUnavailable":
      return t.common.errors.thinkingUnavailable
    case "RateLimited":
      return t.common.errors.rateLimited(
        error.retry === null ? 1 : Math.max(1, Math.ceil((error.retry.at - Date.now()) / 60_000))
      )
    case "Unexpected":
      return t.common.errors.trouble
  }
}
