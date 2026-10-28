import { Auth, AuthUpstreamError, type AuthUser, makeVerifyToken, signWebhook } from "@kotori/auth"
import { authSessions, authUsers, Database } from "@kotori/db"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose"
import { KeyObject } from "node:crypto"

interface TestSignUp {
  readonly id: string
  /** A `cookie` header value the fake recognises. */
  readonly cookie: string
}

const tokenFromCookie = (cookie: string | undefined) => cookie?.match(/(?:^|;\s*)kotori_test_session=([^;]+)/)?.[1]

/**
 * A fake of Managed Better Auth for tests. Like the real one, it keeps users and sessions in
 * the `neon_auth` schema of Kotori's database (the stand-in `DatabaseMemory` creates), so the
 * services read identity exactly as they do in production. Tokens are real EdDSA JWTs, so
 * the token path is exercised end to end.
 */
export class TestAuth extends Context.Service<
  TestAuth,
  {
    readonly issuer: string
    readonly jwks: JWTVerifyGetKey
    signUp(email: string, name: string): Effect.Effect<TestSignUp>
    /** A short-lived JWT for the session, like `GET /token`. */
    token(cookie: string): Effect.Effect<string>
    /** The user whose session the cookie carries. */
    userForCookie(cookie: string | undefined): Effect.Effect<Option.Option<AuthUser>>
    /** Headers that sign `body` as a Managed Auth webhook, sent `ageMs` ago. */
    signWebhook(body: string, options?: { readonly ageMs?: number }): Effect.Effect<Record<string, string>>
    webhookKey(kid: string): Option.Option<KeyObject>
    /** Simulates an outage: session checks and key-set fetches fail until switched back on. */
    setReachable(reachable: boolean): void
    reachable(): boolean
  }
>()("@kotori/services/TestAuth") {
  static readonly layer = Layer.effect(
    TestAuth,
    Effect.gen(function* () {
      const db = yield* Database
      const issuer = "https://auth.test.invalid"
      const { privateKey, publicKey } = yield* Effect.promise(() => generateKeyPair("EdDSA", { crv: "Ed25519" }))
      const jwk = yield* Effect.promise(() => exportJWK(publicKey))
      const local = createLocalJWKSet({ keys: [{ ...jwk, kid: "test", alg: "EdDSA" }] })
      let reachable = true
      const jwks: JWTVerifyGetKey = (header, token) =>
        reachable ? local(header, token) : Promise.reject(new TypeError("fetch failed"))
      let counter = 0

      const userForCookie = Effect.fn("TestAuth.userForCookie")(function* (cookie: string | undefined) {
        const session = tokenFromCookie(cookie)
        if (session === undefined) return Option.none<AuthUser>()
        const rows = yield* db
          .select({
            id: authUsers.id,
            email: authUsers.email,
            emailVerified: authUsers.emailVerified,
            name: authUsers.name,
            createdAt: authUsers.createdAt
          })
          .from(authSessions)
          .innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
          .where(eq(authSessions.id, session))
        return Option.fromNullishOr(rows[0])
      }, Effect.orDie)

      const signUp = Effect.fn("TestAuth.signUp")(function* (email: string, name: string) {
        counter++
        const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`
        const session = `session-${counter}`
        yield* db
          .insert(authUsers)
          .values({ id, email: email.toLowerCase(), emailVerified: false, name, createdAt: new Date() })
        yield* db.insert(authSessions).values({ id: session, userId: id, expiresAt: new Date(Date.now() + 86_400_000) })
        return { id, cookie: `kotori_test_session=${session}` }
      }, Effect.orDie)

      const token = Effect.fn("TestAuth.token")(function* (cookie: string) {
        const user = Option.getOrThrow(yield* userForCookie(cookie))
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
      })

      return TestAuth.of({
        issuer,
        jwks,
        signUp,
        token,
        userForCookie,
        signWebhook: (body, options) =>
          Effect.promise(() => signWebhook(privateKey, "test", body, Date.now() - (options?.ageMs ?? 0))),
        webhookKey: (kid) => (kid === "test" ? Option.some(KeyObject.from(publicKey)) : Option.none()),
        setReachable: (value) => {
          reachable = value
        },
        reachable: () => reachable
      })
    })
  )
}

const down = () => new AuthUpstreamError({ message: "The test auth server is down" })

/** `Auth` over `TestAuth`, for tests; sign up through `TestAuth`. */
export const AuthMemory = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const fake = yield* TestAuth
    return Auth.of({
      forward: () => Effect.die("Auth.forward is not available in tests"),
      sessionFromCookies: (headers) => (fake.reachable() ? fake.userForCookie(headers["cookie"]) : Effect.fail(down())),
      verifyToken: makeVerifyToken(fake.jwks, fake.issuer),
      webhookKey: (kid) => (fake.reachable() ? Effect.succeed(fake.webhookKey(kid)) : Effect.fail(down())),
      // The fake has no passwords; the name and address are all the CLI needs back.
      signUp: ({ email, name }) =>
        fake.signUp(email, name).pipe(
          Effect.flatMap(({ cookie }) => fake.userForCookie(cookie)),
          Effect.map(Option.getOrThrow)
        )
    })
  })
)
