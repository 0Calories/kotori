import { UserId } from "@kotori/db"
import { asc, eq, sql } from "drizzle-orm"
import { Config, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Cookies from "effect/http/Cookies"
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as JoseErrors,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  jwtVerify,
  SignJWT
} from "jose"
import { KeyObject } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { authSessions, authUsers } from "../../db/neonAuth.ts"
import { configuredWebOrigins, webOriginAllowed } from "../../http/cors.ts"
import { ed25519Key, signWebhook } from "./WebhookSignature.ts"

export interface AuthUser {
  readonly id: UserId
  readonly email: string
  readonly emailVerified: boolean
  readonly name: string
  readonly createdAt: Date
}

export interface Forwarded {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
  readonly setCookies: ReadonlyArray<string>
}

const RawUser = Schema.Struct({
  id: UserId,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  createdAt: Schema.Union([Schema.Date, Schema.DateFromString])
})
const decodeUser = (raw: unknown): AuthUser => Schema.decodeUnknownSync(RawUser)(raw)

const SessionResponse = Schema.NullOr(Schema.Struct({ user: RawUser }))
const decodeSession = Schema.decodeUnknownSync(SessionResponse)

const TokenClaims = Schema.Struct({
  sub: UserId,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  createdAt: Schema.DateFromString
})
const decodeClaims = Schema.decodeUnknownOption(TokenClaims)

export class AuthUpstreamError extends Schema.TaggedError<AuthUpstreamError>()("AuthUpstreamError", {
  message: Schema.String
}) {}

const UPSTREAM_TIMEOUT = Duration.seconds(10)

const FORWARDED_HEADERS = ["cookie", "content-type", "accept", "origin", "user-agent", "authorization"]

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
  forward(
    request: HttpServerRequest.HttpServerRequest,
    path: string
  ): Effect.Effect<HttpServerResponse.HttpServerResponse>
  sessionFromCookies(headers: Headers.Headers): Effect.Effect<Option.Option<AuthUser>, AuthUpstreamError>
  verifyToken(token: string): Effect.Effect<Option.Option<AuthUser>, AuthUpstreamError>
  webhookKey(kid: string): Effect.Effect<Option.Option<KeyObject>, AuthUpstreamError>
  deleteUser(userId: UserId): Effect.Effect<void>
  signUp(input: {
    readonly email: string
    readonly password: string
    readonly name: string
  }): Effect.Effect<AuthUser, AuthUpstreamError>
  setEmailVerified(userId: UserId): Effect.Effect<void>
  readonly users: Effect.Effect<ReadonlyArray<AuthUser>>
  userByEmail(email: string): Effect.Effect<Option.Option<AuthUser>>
  revokeSessions(userId: UserId): Effect.Effect<void>
}

const toResponse = (forwarded: Forwarded) => {
  const options = {
    status: forwarded.status,
    headers: forwarded.headers,
    cookies: Cookies.fromSetCookie(forwarded.setCookies)
  }
  // Avoid HttpServerResponse.uint8Array's default application/octet-stream content-type on empty 204 and redirect responses.
  return forwarded.body.length === 0
    ? HttpServerResponse.empty(options)
    : HttpServerResponse.uint8Array(forwarded.body, options)
}

const upstreamFailed = HttpServerResponse.text(
  JSON.stringify({ message: "The sign-in service is unavailable.", code: "AUTH_UNAVAILABLE" }),
  { status: 502, contentType: "application/json" }
)

export class Auth extends Context.Service<Auth, AuthService>()("@kotori/backend/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const baseUrl = (yield* Config.String("NEON_AUTH_BASE_URL")).replace(/\/$/, "")
      const db = yield* Database
      const allowedWebOrigin = webOriginAllowed(yield* configuredWebOrigins, true)
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
            // Rewrite missing or allowed origins to the auth server's origin because Better Auth enforces Origin CSRF checks and Neon Auth rejects mid-label wildcard preview domains.
            const requestOrigin = headers.get("origin")
            if (requestOrigin === null || allowedWebOrigin(requestOrigin)) headers.set("origin", origin)
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
          // Better Auth returns HTTP 200 with a JSON null body when signed out; 429 and 5xx indicate upstream failure.
          if (response.status >= 500 || response.status === 429) {
            return yield* new AuthUpstreamError({ message: `/get-session answered ${response.status}` })
          }
          if (response.status !== 200) return Option.none<AuthUser>()
          const session = yield* Effect.try({
            try: () => decodeSession(JSON.parse(new TextDecoder().decode(response.body))),
            catch: (error) => new AuthUpstreamError({ message: `Unreadable /get-session response: ${String(error)}` })
          })
          return session === null ? Option.none<AuthUser>() : Option.some(decodeUser(session.user))
        },
        Effect.tapError((error) => Effect.logWarning("Could not resolve the session", error))
      )

      const hasSession = (userId: UserId) =>
        db.$count(authSessions, eq(authSessions.userId, userId)).pipe(
          Effect.map((n) => n > 0),
          Effect.orDie
        )

      const verifyToken = makeVerifyToken(jwks, origin, hasSession)

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

      const list = db
        .select()
        .from(authUsers)
        .orderBy(asc(authUsers.createdAt))
        .pipe(
          Effect.map((rows) => rows.map(decodeUser)),
          Effect.orDie
        )

      const userByEmail = Effect.fn("Auth.userByEmail")(function* (email: string) {
        const rows = yield* db
          .select()
          .from(authUsers)
          .where(eq(sql`lower(${authUsers.email})`, email.trim().toLowerCase()))
        return Option.fromNullishOr(rows[0]).pipe(Option.map(decodeUser))
      }, Effect.orDie)

      const revokeSessions = (userId: UserId) =>
        db.delete(authSessions).where(eq(authSessions.userId, userId)).pipe(Effect.asVoid, Effect.orDie)

      // Managed Auth disables Better Auth's /delete-user endpoint, so delete the neon_auth.user row directly.
      const deleteUser = (userId: UserId) =>
        db.delete(authUsers).where(eq(authUsers.id, userId)).pipe(Effect.asVoid, Effect.orDie)

      const signUp = Effect.fn("Auth.signUp")(function* (input: {
        readonly email: string
        readonly password: string
        readonly name: string
      }) {
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

      const setEmailVerified = (userId: UserId) =>
        db
          .update(authUsers)
          .set({ emailVerified: true })
          .where(eq(authUsers.id, userId))
          .pipe(Effect.asVoid, Effect.orDie)

      return Auth.of({
        forward,
        sessionFromCookies,
        verifyToken,
        webhookKey,
        deleteUser,
        signUp,
        setEmailVerified,
        users: list,
        userByEmail,
        revokeSessions
      })
    })
  )

  static readonly layerMemory = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const store = yield* TestAuth

      const sessionFromCookies = (headers: Headers.Headers) =>
        store.reachable()
          ? Effect.sync(() => store.userForCookie(headers["cookie"]))
          : Effect.fail(new AuthUpstreamError({ message: "The test auth server is down" }))
      const verifyToken = makeVerifyToken(store.jwks, store.issuer, (userId) =>
        Effect.sync(() => store.hasSession(userId))
      )

      return Auth.of({
        forward: () => Effect.die("Auth.forward is not available in tests"),
        sessionFromCookies,
        verifyToken,
        webhookKey: (kid) =>
          store.reachable()
            ? Effect.succeed(store.webhookKey(kid))
            : Effect.fail(new AuthUpstreamError({ message: "The test auth server is down" })),
        deleteUser: (userId) => Effect.sync(() => store.remove(userId)),
        signUp: ({ email, name }) =>
          store.signUp(email, name).pipe(
            Effect.map(({ id }) => ({
              id,
              email: email.toLowerCase(),
              emailVerified: false,
              name,
              createdAt: new Date()
            }))
          ),
        setEmailVerified: (userId) => Effect.sync(() => store.setEmailVerified(userId)),
        users: Effect.sync(() => store.all()),
        userByEmail: (email) => Effect.sync(() => store.byEmail(email)),
        revokeSessions: (userId) => Effect.sync(() => store.revoke(userId))
      })
    })
  )
}

class KeySetUnavailable extends Error {}

// Wrap JWKS fetch errors separately from key-lookup misses so verifyToken returns 503 on outages instead of treating tokens as invalid.
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

const makeVerifyToken = (
  jwks: JWTVerifyGetKey,
  issuer: string,
  hasSession: (userId: UserId) => Effect.Effect<boolean>
) => {
  const keys = distinguishOutages(jwks)
  return Effect.fn("Auth.verifyToken")(
    function* (token: string) {
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
      // Check authSessions so account deletion or session revocation takes effect before the JWT expires.
      if (Option.isNone(user) || !(yield* hasSession(user.value.id))) return Option.none<AuthUser>()
      return user
    },
    Effect.tapError((error) => Effect.logWarning("Could not verify the token", error))
  )
}

interface TestSignUp {
  readonly id: UserId
  readonly cookie: string
}

export class TestAuth extends Context.Service<
  TestAuth,
  {
    readonly issuer: string
    readonly jwks: JWTVerifyGetKey
    signUp(email: string, name: string): Effect.Effect<TestSignUp>
    token(cookie: string): Effect.Effect<string>
    setEmailVerified(userId: UserId): void
    signWebhook(body: string, options?: { readonly ageMs?: number }): Effect.Effect<Record<string, string>>
    webhookKey(kid: string): Option.Option<KeyObject>
    userForCookie(cookie: string | undefined): Option.Option<AuthUser>
    hasSession(userId: UserId): boolean
    setReachable(reachable: boolean): void
    reachable(): boolean
    byEmail(email: string): Option.Option<AuthUser>
    all(): ReadonlyArray<AuthUser>
    revoke(userId: UserId): void
    remove(userId: UserId): void
  }
>()("@kotori/backend/TestAuth") {
  static readonly layer = Layer.effect(
    TestAuth,
    Effect.gen(function* () {
      const issuer = "https://auth.test.invalid"
      const { privateKey, publicKey } = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      const jwk = yield* Effect.promise(() => exportJWK(publicKey))
      const local = createLocalJWKSet({ keys: [{ ...jwk, kid: "test", alg: "EdDSA" }] })
      let reachable = true
      const jwks: JWTVerifyGetKey = (header, token) =>
        reachable ? local(header, token) : Promise.reject(new TypeError("fetch failed"))

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
            const id = UserId.make(`00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`)
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
        signWebhook: (body, options) =>
          Effect.promise(() => signWebhook(privateKey, "test", body, Date.now() - (options?.ageMs ?? 0))),
        webhookKey: (kid) => (kid === "test" ? Option.some(KeyObject.from(publicKey)) : Option.none()),
        userForCookie,
        hasSession: (userId) => [...sessions.values()].includes(userId),
        setEmailVerified: (userId) => {
          const user = users.get(userId)
          if (user !== undefined) users.set(userId, { ...user, emailVerified: true })
        },
        setReachable: (value) => {
          reachable = value
        },
        reachable: () => reachable,
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
