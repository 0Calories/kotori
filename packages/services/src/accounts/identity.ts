import { Auth, type AuthUser } from "@kotori/auth"
import { authSessions, authUsers, Database } from "@kotori/db"
import { asc, eq, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { Headers } from "effect/http"

// Identity is Managed Better Auth's: it writes users and sessions to the `neon_auth` schema
// of Kotori's own database, and these read them (and revoke and delete) directly.

/** Every user in sign-up order. */
export const identities = Effect.gen(function* () {
  const db = yield* Database
  const rows: ReadonlyArray<AuthUser> = yield* db.select().from(authUsers).orderBy(asc(authUsers.createdAt))
  return rows
}).pipe(Effect.orDie, Effect.withSpan("accounts.identities"))

/** The user with this address, whatever its case. */
export const identityByEmail = Effect.fn("accounts.identityByEmail")(function* (email: string) {
  const db = yield* Database
  const rows = yield* db
    .select()
    .from(authUsers)
    .where(eq(sql`lower(${authUsers.email})`, email.trim().toLowerCase()))
  return Option.fromNullishOr(rows[0])
}, Effect.orDie)

const hasSession = Effect.fn("accounts.hasSession")(function* (userId: string) {
  const db = yield* Database
  return (yield* db.$count(authSessions, eq(authSessions.userId, userId))) > 0
}, Effect.orDie)

/** What a request signs in with: the app's managed JWT, or the web's session cookie. */
export type Credentials = { readonly token: string } | { readonly cookies: Headers.Headers }

/**
 * The signed-in user behind a request, if any. A token must verify and its user must
 * still have a session; a cookie is checked with Managed Auth. Fails, rather than
 * answering none, when Managed Auth can't say.
 */
export const authenticate = Effect.fn("accounts.authenticate")(function* (credentials: Credentials) {
  const auth = yield* Auth
  return yield* "token" in credentials
    ? auth.verifyToken(credentials.token, hasSession)
    : auth.sessionFromCookies(credentials.cookies)
})

/** Signs the user out everywhere. */
export const revokeSessions = Effect.fn("accounts.revokeSessions")(function* (userId: string) {
  const db = yield* Database
  yield* db.delete(authSessions).where(eq(authSessions.userId, userId))
}, Effect.orDie)
