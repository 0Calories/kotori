import { Config, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Cookies from "effect/http/Cookies"
import { createRemoteJWKSet, errors as JoseErrors, type JWTVerifyGetKey, jwtVerify } from "jose"
import type { KeyObject } from "node:crypto"
import { ed25519Key } from "./WebhookSignature.ts"

/**
 * A Managed Better Auth user as Kotori reads it: from the session or token here, from
 * `neon_auth` in `@kotori/services`. Approval status and role live on the learner profile.
 */
export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
  readonly name: string
  readonly createdAt: Date
}

/** A proxied upstream response: status, the headers worth relaying, body and `Set-Cookie`. */
export interface Forwarded {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
  readonly setCookies: ReadonlyArray<string>
}

// `createdAt` arrives as an ISO string in the auth server's JSON.
const RawUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  createdAt: Schema.DateFromString
})
const decodeUser = (raw: unknown): AuthUser => Schema.decodeUnknownSync(RawUser)(raw)

const SessionResponse = Schema.NullOr(Schema.Struct({ user: RawUser }))
const decodeSession = Schema.decodeUnknownSync(SessionResponse)

/** The claims a managed JWT (`GET /token`) carries about its user. */
const TokenClaims = Schema.Struct({
  sub: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  createdAt: Schema.DateFromString
})
const decodeClaims = Schema.decodeUnknownOption(TokenClaims)

/** Managed Auth could not be reached, timed out, or answered with a server error. */
export class AuthUpstreamError extends Schema.TaggedError<AuthUpstreamError>()("AuthUpstreamError", {
  message: Schema.String
}) {}

/** How long a call to Managed Auth may take before it counts as unreachable. */
const UPSTREAM_TIMEOUT = Duration.seconds(10)

/** Request headers worth forwarding to the auth server; everything else is hop-by-hop or ours. */
const FORWARDED_HEADERS = ["cookie", "content-type", "accept", "origin", "user-agent", "authorization"]

/**
 * Response headers relayed back besides `Set-Cookie`: redirects (verification and reset
 * links), caching, Better Auth's token headers and its rate-limit hints.
 */
const RELAYED_HEADERS = [
  "content-type",
  "location",
  "cache-control",
  "retry-after",
  "x-retry-after",
  "set-auth-jwt",
  "set-auth-token",
  "www-authenticate"
]

export interface AuthService {
  /**
   * Forwards a request under `/api/auth/*` to Managed Better Auth with its cookies and
   * body, and relays the response including `Set-Cookie`, so the app keeps one origin.
   */
  forward(
    request: HttpServerRequest.HttpServerRequest,
    path: string
  ): Effect.Effect<HttpServerResponse.HttpServerResponse>
  /**
   * The signed-in user behind the request's session cookie, via `/get-session`. Fails,
   * rather than answering none, when Managed Auth can't say.
   */
  sessionFromCookies(headers: Headers.Headers): Effect.Effect<Option.Option<AuthUser>, AuthUpstreamError>
  /**
   * The user a managed JWT (from `GET /token`) was issued to, if the token verifies against
   * the JWKS and `hasSession` says the user still has a session: deleting the account or
   * revoking its sessions ends access at once, not when the token expires. Sessions live in
   * `neon_auth`, so the check is the caller's. Fails, rather than answering none, when the
   * key set can't be fetched.
   */
  verifyToken<R>(
    token: string,
    hasSession: (userId: string) => Effect.Effect<boolean, never, R>
  ): Effect.Effect<Option.Option<AuthUser>, AuthUpstreamError, R>
  /**
   * The Ed25519 key Managed Auth signed a webhook with (`X-Neon-Signature-Kid`), from the
   * same key set as the JWTs, refetched when the id is unknown. None for an unknown id
   * or a key that isn't Ed25519; fails when the key set can't be fetched.
   */
  webhookKey(kid: string): Effect.Effect<Option.Option<KeyObject>, AuthUpstreamError>
  /**
   * Creates an account with a password, as the sign-up screen does. Used by the CLI to
   * make the local development account; learners always go through the app.
   */
  signUp(input: {
    readonly email: string
    readonly password: string
    readonly name: string
  }): Effect.Effect<AuthUser, AuthUpstreamError>
}

/** The origin a request reached us at, honouring the proxy headers Fly (and most hosts) set. */
const requestOrigin = (headers: Headers.Headers) => {
  const proto = headers["x-forwarded-proto"]?.split(",")[0]?.trim() ?? "http"
  const host = headers["x-forwarded-host"]?.split(",")[0]?.trim() ?? headers["host"] ?? "localhost"
  return `${proto}://${host}`
}

const toResponse = (forwarded: Forwarded) => {
  const options = {
    status: forwarded.status,
    headers: forwarded.headers,
    cookies: Cookies.fromSetCookie(forwarded.setCookies)
  }
  // An empty body (redirects, 204s) goes out without one, rather than as application/octet-stream.
  return forwarded.body.length === 0
    ? HttpServerResponse.empty(options)
    : HttpServerResponse.uint8Array(forwarded.body, options)
}

const upstreamFailed = HttpServerResponse.text(
  JSON.stringify({ message: "The sign-in service is unavailable.", code: "AUTH_UNAVAILABLE" }),
  { status: 502, contentType: "application/json" }
)

/**
 * Neon's Managed Better Auth, reached at `NEON_AUTH_BASE_URL`. The service runs
 * upstream; identity lands in the `neon_auth` schema of Kotori's own database, which
 * `@kotori/services` reads and writes. Everything a learner does (sign up, sign in,
 * verify, reset) flows through `forward`.
 */
export class Auth extends Context.Service<Auth, AuthService>()("@kotori/auth/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const baseUrl = (yield* Config.String("NEON_AUTH_BASE_URL")).replace(/\/$/, "")
      // Managed JWTs name the auth endpoint's origin as issuer and audience.
      const origin = new URL(baseUrl).origin
      const jwks = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`))

      const upstream = (
        path: string,
        init: { method: string; headers: Headers.Headers; body?: Uint8Array | undefined }
      ) =>
        Effect.tryPromise({
          try: async (signal): Promise<Forwarded> => {
            const headers = new globalThis.Headers()
            for (const name of FORWARDED_HEADERS) {
              const value = init.headers[name]
              if (value !== undefined) headers.set(name, value)
            }
            // Better Auth requires an Origin (CSRF check, relative callback URLs). Browsers send
            // the web app's; native apps send none, so stand in with the API's own public origin,
            // which must be one of the trusted domains like the web origin is.
            if (!headers.has("origin")) headers.set("origin", requestOrigin(init.headers))
            const options: RequestInit = {
              method: init.method,
              headers,
              redirect: "manual",
              signal: AbortSignal.any([signal, AbortSignal.timeout(Duration.toMillis(UPSTREAM_TIMEOUT))])
            }
            if (init.body !== undefined && init.method !== "GET" && init.method !== "HEAD") options.body = init.body
            const response = await fetch(`${baseUrl}${path}`, options)
            const relayed: Record<string, string> = {}
            for (const name of RELAYED_HEADERS) {
              const value = response.headers.get(name)
              if (value !== null) relayed[name] = value
            }
            return {
              status: response.status,
              headers: relayed,
              body: new Uint8Array(await response.arrayBuffer()),
              setCookies: response.headers.getSetCookie()
            }
          },
          catch: (error) => new AuthUpstreamError({ message: String(error) })
        })

      const sessionFromCookies = Effect.fn("Auth.sessionFromCookies")(
        function* (headers: Headers.Headers) {
          if (headers["cookie"] === undefined) return Option.none<AuthUser>()
          const response = yield* upstream("/get-session", { method: "GET", headers })
          // A server error or rate limit says nothing about the cookie; anything else that
          // isn't a session (Better Auth answers `null` with 200) means signed out.
          if (response.status >= 500 || response.status === 429) {
            return yield* new AuthUpstreamError({ message: `/get-session answered ${response.status}` })
          }
          if (response.status !== 200) return Option.none<AuthUser>()
          const session = yield* Effect.try({
            try: () => decodeSession(JSON.parse(new TextDecoder().decode(response.body))),
            catch: (error) => new AuthUpstreamError({ message: `Unreadable /get-session response: ${String(error)}` })
          })
          return session === null ? Option.none<AuthUser>() : Option.some<AuthUser>(session.user)
        },
        Effect.tapError((error) => Effect.logWarning("Could not resolve the session", error))
      )

      const verifyToken = makeVerifyToken(jwks, origin)

      // Looked up by id alone, as Neon's verification steps do, through jose's cache: a
      // stale set is refreshed, and an unknown id refetches it at most every 30 s.
      const webhookKey = Effect.fn("Auth.webhookKey")(function* (kid: string) {
        const jwk = yield* Effect.tryPromise({
          try: async () => {
            const find = () => jwks.jwks()?.keys.find((key) => key.kid === kid)
            if (!jwks.fresh) await jwks.reload()
            if (find() === undefined && !jwks.coolingDown) await jwks.reload()
            return find()
          },
          catch: (error) => new AuthUpstreamError({ message: `JWKS unavailable: ${String(error)}` })
        })
        return Option.fromNullishOr(jwk === undefined ? undefined : ed25519Key(jwk))
      })

      const forward = Effect.fn("Auth.forward")(
        function* (request: HttpServerRequest.HttpServerRequest, path: string) {
          const body = new Uint8Array(yield* request.arrayBuffer)
          return toResponse(yield* upstream(path, { method: request.method, headers: request.headers, body }))
        },
        Effect.catchCause((cause) =>
          Effect.logWarning("Managed Auth request failed", cause).pipe(Effect.as(upstreamFailed))
        )
      )

      const signUp = Effect.fn("Auth.signUp")(function* (input: {
        readonly email: string
        readonly password: string
        readonly name: string
      }) {
        // No cookies to forward and no browser in play, so stand in with the base URL's
        // own origin, which is trusted by definition.
        const response = yield* upstream("/sign-up/email", {
          method: "POST",
          headers: Headers.fromInput({ "content-type": "application/json", origin }),
          body: new TextEncoder().encode(JSON.stringify(input))
        })
        const text = new TextDecoder().decode(response.body)
        if (response.status !== 200) {
          return yield* new AuthUpstreamError({ message: `/sign-up/email answered ${response.status}: ${text}` })
        }
        return yield* Effect.try({
          try: () => decodeUser((JSON.parse(text) as { readonly user: unknown }).user),
          catch: (error) => new AuthUpstreamError({ message: `Unreadable /sign-up/email response: ${String(error)}` })
        })
      })

      return Auth.of({ forward, sessionFromCookies, verifyToken, webhookKey, signUp })
    })
  )
}

/** The key set itself couldn't be had (network, timeout, a non-200 answer), as opposed to a bad token. */
class KeySetUnavailable extends Error {}

/** Marks key-set fetch failures so `verifyToken` doesn't mistake an outage for a forged token. */
const distinguishOutages =
  (jwks: JWTVerifyGetKey): JWTVerifyGetKey =>
  async (header, token) => {
    try {
      return await jwks(header, token)
    } catch (error) {
      if (error instanceof JoseErrors.JWKSNoMatchingKey || error instanceof JoseErrors.JWKSMultipleMatchingKeys) {
        throw error
      }
      throw new KeySetUnavailable(String(error), { cause: error })
    }
  }

/**
 * `AuthService.verifyToken` over a key set and the issuer (and audience) managed JWTs
 * name: the auth endpoint's origin upstream, a fake's in tests.
 */
export const makeVerifyToken = (jwks: JWTVerifyGetKey, issuer: string): AuthService["verifyToken"] => {
  const keys = distinguishOutages(jwks)
  return Effect.fn("Auth.verifyToken")(
    function* <R>(token: string, hasSession: (userId: string) => Effect.Effect<boolean, never, R>) {
      const verified = yield* Effect.tryPromise({
        try: () => jwtVerify(token, keys, { issuer, audience: issuer, algorithms: ["EdDSA"] }),
        catch: (error) => error
      }).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          error instanceof KeySetUnavailable
            ? Effect.fail(new AuthUpstreamError({ message: `JWKS unavailable: ${error.message}` }))
            : Effect.succeed(Option.none())
        )
      )
      const user = Option.flatMap(verified, (result) =>
        decodeClaims(result.payload).pipe(
          Option.map((claims): AuthUser => ({
            id: claims.sub,
            email: claims.email,
            emailVerified: claims.emailVerified,
            name: claims.name,
            createdAt: claims.createdAt
          }))
        )
      )
      if (Option.isNone(user) || !(yield* hasSession(user.value.id))) return Option.none<AuthUser>()
      return user
    },
    Effect.tapError((error) => Effect.logWarning("Could not verify the token", error))
  )
}
