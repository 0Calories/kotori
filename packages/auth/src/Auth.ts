import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { type Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Cookies from "effect/http/Cookies"
import { SqlClient } from "effect/sql"
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  jwtVerify,
  SignJWT
} from "jose"

/** A Managed Better Auth user as Kotori reads it. Approval status and role live on the learner profile. */
export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
  readonly name: string
  readonly createdAt: Date
}

/** A proxied upstream response: status, body and the `Set-Cookie` headers to relay. */
export interface Forwarded {
  readonly status: number
  readonly contentType: string | null
  readonly body: Uint8Array
  readonly setCookies: ReadonlyArray<string>
}

// `createdAt` arrives as an ISO string from the auth server's JSON and as a Date from the SQL driver.
const RawUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  createdAt: Schema.Union([Schema.Date, Schema.DateFromString])
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

/** Managed Auth could not be reached or answered with something other than HTTP. */
export class AuthUpstreamError extends Schema.TaggedError<AuthUpstreamError>()("AuthUpstreamError", {
  message: Schema.String
}) {}

/** Request headers worth forwarding to the auth server; everything else is hop-by-hop or ours. */
const FORWARDED_HEADERS = ["cookie", "content-type", "accept", "origin", "user-agent", "authorization"]

export interface AuthService {
  /**
   * Forwards a request under `/api/auth/*` to Managed Better Auth with its cookies and
   * body, and relays the response including `Set-Cookie`, so the app keeps one origin.
   */
  forward(
    request: HttpServerRequest.HttpServerRequest,
    path: string
  ): Effect.Effect<HttpServerResponse.HttpServerResponse>
  /** The signed-in user behind the request's session cookie, via `/get-session`. */
  sessionFromCookies(headers: Headers.Headers): Effect.Effect<Option.Option<AuthUser>>
  /** The user a managed JWT (from `GET /token`) was issued to, if the token verifies against the JWKS. */
  verifyToken(token: string): Effect.Effect<Option.Option<AuthUser>>
  /**
   * Deletes the identity: the `neon_auth` user row, whose sessions and accounts cascade.
   * Managed Auth doesn't enable Better Auth's own `/delete-user`, and identity lives in
   * Kotori's database anyway, so this is a plain SQL delete.
   */
  deleteUser(userId: string): Effect.Effect<void>
  /** Every user in sign-up order. */
  readonly users: Effect.Effect<ReadonlyArray<AuthUser>>
  userByEmail(email: string): Effect.Effect<Option.Option<AuthUser>>
  /** Signs the user out everywhere. */
  revokeSessions(userId: string): Effect.Effect<void>
}

/** The origin a request reached us at, honouring the proxy headers Fly (and most hosts) set. */
const requestOrigin = (headers: Headers.Headers) => {
  const proto = headers["x-forwarded-proto"]?.split(",")[0]?.trim() ?? "http"
  const host = headers["x-forwarded-host"]?.split(",")[0]?.trim() ?? headers["host"] ?? "localhost"
  return `${proto}://${host}`
}

const toResponse = (forwarded: Forwarded) =>
  HttpServerResponse.uint8Array(forwarded.body, {
    status: forwarded.status,
    ...(forwarded.contentType === null ? {} : { contentType: forwarded.contentType }),
    cookies: Cookies.fromSetCookie(forwarded.setCookies)
  })

const upstreamFailed = HttpServerResponse.text(
  JSON.stringify({ message: "The sign-in service is unavailable.", code: "AUTH_UNAVAILABLE" }),
  { status: 502, contentType: "application/json" }
)

/**
 * Neon's Managed Better Auth, reached at `NEON_AUTH_BASE_URL`. The service runs
 * upstream; identity lands in the `neon_auth` schema of Kotori's own database,
 * which is where reads (and session revocation) go. Everything a learner does
 * (sign up, sign in, verify, reset, delete) flows through `forward`.
 */
export class Auth extends Context.Service<Auth, AuthService>()("@kotori/auth/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const baseUrl = (yield* Config.String("NEON_AUTH_BASE_URL")).replace(/\/$/, "")
      const sql = yield* SqlClient.SqlClient
      // Managed JWTs name the auth endpoint's origin as issuer and audience.
      const origin = new URL(baseUrl).origin
      const jwks = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`))

      const upstream = (
        path: string,
        init: { method: string; headers: Headers.Headers; body?: Uint8Array | undefined }
      ) =>
        Effect.tryPromise({
          try: async (): Promise<Forwarded> => {
            const headers = new globalThis.Headers()
            for (const name of FORWARDED_HEADERS) {
              const value = init.headers[name]
              if (value !== undefined) headers.set(name, value)
            }
            // Better Auth requires an Origin (CSRF check, relative callback URLs). Browsers send
            // the web app's; native apps send none, so stand in with the API's own public origin,
            // which must be one of the trusted domains like the web origin is.
            if (!headers.has("origin")) headers.set("origin", requestOrigin(init.headers))
            const options: RequestInit = { method: init.method, headers, redirect: "manual" }
            if (init.body !== undefined && init.method !== "GET" && init.method !== "HEAD") options.body = init.body
            const response = await fetch(`${baseUrl}${path}`, options)
            return {
              status: response.status,
              contentType: response.headers.get("content-type"),
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
          if (response.status !== 200) return Option.none<AuthUser>()
          const session = decodeSession(JSON.parse(new TextDecoder().decode(response.body)))
          return session === null ? Option.none<AuthUser>() : Option.some(decodeUser(session.user))
        },
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not resolve the session", cause).pipe(Effect.as(Option.none()))
        )
      )

      const verifyToken = makeVerifyToken(jwks, origin)

      const forward = Effect.fn("Auth.forward")(
        function* (request: HttpServerRequest.HttpServerRequest, path: string) {
          const body = new Uint8Array(yield* request.arrayBuffer)
          return toResponse(yield* upstream(path, { method: request.method, headers: request.headers, body }))
        },
        Effect.catchCause((cause) =>
          Effect.logWarning("Managed Auth request failed", cause).pipe(Effect.as(upstreamFailed))
        )
      )

      const list = sql`
        SELECT id, email, "emailVerified" AS email_verified, name, "createdAt" AS created_at
        FROM neon_auth."user" ORDER BY "createdAt"
      `.pipe(
        Effect.map((rows) => rows.map(decodeUser)),
        Effect.orDie
      )

      const userByEmail = Effect.fn("Auth.userByEmail")(function* (email: string) {
        const rows = yield* sql`
          SELECT id, email, "emailVerified" AS email_verified, name, "createdAt" AS created_at
          FROM neon_auth."user" WHERE lower(email) = ${email.trim().toLowerCase()}
        `
        return Option.fromNullishOr(rows[0]).pipe(Option.map(decodeUser))
      }, Effect.orDie)

      const revokeSessions = (userId: string) =>
        sql`DELETE FROM neon_auth.session WHERE "userId" = ${userId}::uuid`.pipe(Effect.asVoid, Effect.orDie)

      const deleteUser = (userId: string) =>
        sql`DELETE FROM neon_auth."user" WHERE id = ${userId}::uuid`.pipe(Effect.asVoid, Effect.orDie)

      return Auth.of({
        forward,
        sessionFromCookies,
        verifyToken,
        deleteUser,
        users: list,
        userByEmail,
        revokeSessions
      })
    })
  )

  /** An in-memory stand-in for tests; sign up through `TestAuth`. */
  static readonly layerMemory = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const store = yield* TestAuth

      const sessionFromCookies = (headers: Headers.Headers) => Effect.sync(() => store.userForCookie(headers["cookie"]))
      const verifyToken = makeVerifyToken(store.jwks, store.issuer)

      return Auth.of({
        forward: () => Effect.die("Auth.forward is not available in tests"),
        sessionFromCookies,
        verifyToken,
        deleteUser: (userId) => Effect.sync(() => store.remove(userId)),
        users: Effect.sync(() => store.all()),
        userByEmail: (email) => Effect.sync(() => store.byEmail(email)),
        revokeSessions: (userId) => Effect.sync(() => store.revoke(userId))
      })
    })
  )
}

const makeVerifyToken = (jwks: JWTVerifyGetKey, issuer: string) =>
  Effect.fn("Auth.verifyToken")(
    function* (token: string) {
      const verified = yield* Effect.tryPromise(() =>
        jwtVerify(token, jwks, { issuer, audience: issuer, algorithms: ["EdDSA"] })
      )
      return decodeClaims(verified.payload).pipe(
        Option.map((claims): AuthUser => ({
          id: claims.sub,
          email: claims.email,
          emailVerified: claims.emailVerified,
          name: claims.name,
          createdAt: claims.createdAt
        }))
      )
    },
    Effect.catchCause(() => Effect.succeed(Option.none<AuthUser>()))
  )

interface TestSignUp {
  readonly id: string
  /** A `cookie` header value the memory layer recognises. */
  readonly cookie: string
}

/**
 * The fake auth server behind `Auth.layerMemory`: an in-memory user store, cookie
 * sessions, and real EdDSA tokens so the JWT path is exercised end to end.
 */
export class TestAuth extends Context.Service<
  TestAuth,
  {
    readonly issuer: string
    readonly jwks: JWTVerifyGetKey
    signUp(email: string, name: string): Effect.Effect<TestSignUp>
    /** A short-lived JWT for the session, like `GET /token`. */
    token(cookie: string): Effect.Effect<string>
    userForCookie(cookie: string | undefined): Option.Option<AuthUser>
    byEmail(email: string): Option.Option<AuthUser>
    all(): ReadonlyArray<AuthUser>
    revoke(userId: string): void
    remove(userId: string): void
  }
>()("@kotori/auth/TestAuth") {
  static readonly layer = Layer.effect(
    TestAuth,
    Effect.gen(function* () {
      const issuer = "https://auth.test.invalid"
      const { privateKey, publicKey } = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      const jwk = yield* Effect.promise(() => exportJWK(publicKey))
      const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test", alg: "EdDSA" }] })

      const users = new Map<string, AuthUser>()
      const sessions = new Map<string, string>()
      let counter = 0

      const tokenFromCookie = (cookie: string | undefined) =>
        cookie?.match(/(?:^|;\s*)kotori_test_session=([^;]+)/)?.[1]
      const userForCookie = (cookie: string | undefined) =>
        Option.fromNullishOr(tokenFromCookie(cookie))
          .pipe(Option.flatMap((token) => Option.fromNullishOr(sessions.get(token))))
          .pipe(Option.flatMap((id) => Option.fromNullishOr(users.get(id))))

      return TestAuth.of({
        issuer,
        jwks,
        signUp: (email, name) =>
          Effect.sync(() => {
            counter++
            const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`
            users.set(id, { id, email: email.toLowerCase(), emailVerified: false, name, createdAt: new Date() })
            const token = `session-${counter}`
            sessions.set(token, id)
            return { id, cookie: `kotori_test_session=${token}` }
          }),
        token: (cookie) =>
          Effect.gen(function* () {
            const user = Option.getOrThrow(userForCookie(cookie))
            return yield* Effect.promise(() =>
              new SignJWT({
                email: user.email,
                emailVerified: user.emailVerified,
                name: user.name,
                createdAt: user.createdAt.toISOString()
              })
                .setProtectedHeader({ alg: "EdDSA", kid: "test" })
                .setSubject(user.id)
                .setIssuer(issuer)
                .setAudience(issuer)
                .setIssuedAt()
                .setExpirationTime("15m")
                .sign(privateKey)
            )
          }),
        userForCookie,
        byEmail: (email) =>
          Option.fromNullishOr([...users.values()].find((u) => u.email === email.trim().toLowerCase())),
        all: () => [...users.values()],
        revoke: (userId) => {
          for (const [token, id] of sessions) if (id === userId) sessions.delete(token)
        },
        remove: (userId) => {
          users.delete(userId)
          for (const [token, id] of sessions) if (id === userId) sessions.delete(token)
        }
      })
    })
  )
}
