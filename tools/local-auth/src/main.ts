import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { toNodeHandler } from "better-auth/node"
import { emailOTP } from "better-auth/plugins/email-otp"
import { jwt } from "better-auth/plugins/jwt"
import { createServer } from "node:http"
import pg from "pg"
import { sessionVerifier } from "./sessionVerifier.ts"

/**
 * A stand-in for Neon's Managed Better Auth, so the API and worker run on a laptop
 * without a Neon branch. It is Better Auth configured the way Managed Auth is: users
 * and sessions in the `neon_auth` schema with UUID ids, email and password, Email OTP,
 * 15-minute EdDSA JWTs whose issuer and audience are the auth URL's origin, with
 * the key set at `/.well-known/jwks.json`, and Google sign-in with Neon's session
 * verifier handoff (see `sessionVerifier`). Kotori's `Auth` layer talks to it exactly
 * as it does to Managed Auth, at `NEON_AUTH_BASE_URL`.
 *
 * Development only: it refuses to start with NODE_ENV=production, and it is not a
 * dependency of the API or the worker, so it never reaches the deployed image.
 */

// The repository's `.env.local` (the Neon CLI's) and then `.env`; variables already set win, then the first file.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(new URL(`../../../${file}`, import.meta.url))
  } catch {
    // Absent: nothing to load.
  }
}

/** Same as the API's CORS check: this machine or the local network. */
const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

const isLocalOrigin = (origin: string) => {
  try {
    const url = new URL(origin)
    return url.protocol === "http:" && LOCAL_HOST.test(url.hostname)
  } catch {
    return false
  }
}

function fail(message: string): never {
  console.error(`[local-auth] ${message}`)
  process.exit(1)
}

if (process.env["NODE_ENV"] === "production") fail("Refusing to run with NODE_ENV=production.")

const configured = process.env["NEON_AUTH_BASE_URL"]
if (configured === undefined)
  fail("NEON_AUTH_BASE_URL is not set. Copy .env.example to .env (or run `pnpm dev:setup`).")
const base = new URL(configured.replace(/\/$/, ""))
if (base.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(base.hostname)) {
  // A Neon branch (`neon checkout`) is in use instead; nothing to stand in for.
  console.log(`[local-auth] NEON_AUTH_BASE_URL points at ${base.host}, so the local auth server isn't needed.`)
  process.exit(0)
}

const pool = new pg.Pool({
  connectionString: process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori",
  options: "-c search_path=neon_auth"
})

/**
 * Google OAuth against the local stand-in needs a "Web application" OAuth client of your
 * own with redirect URI `<NEON_AUTH_BASE_URL>/callback/google` (production Neon branches
 * need their own too, since Neon's shared credentials don't wrap `/link-social`). Without
 * one, the Google button reports an error.
 */
const googleClientId = process.env["LOCAL_AUTH_GOOGLE_CLIENT_ID"]
const googleClientSecret = process.env["LOCAL_AUTH_GOOGLE_CLIENT_SECRET"]
const google =
  googleClientId && googleClientSecret ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } } : {}
if (!googleClientId || !googleClientSecret) {
  const missing = !googleClientId ? "LOCAL_AUTH_GOOGLE_CLIENT_ID" : "LOCAL_AUTH_GOOGLE_CLIENT_SECRET"
  console.log(`[local-auth] ${missing} is not set, so Google sign-in is off.`)
}

const PRIVATE_172_ORIGINS = Array.from({ length: 16 }, (_, i) => `http://172.${16 + i}.*.*:*`)

const options = {
  baseURL: base.origin,
  basePath: base.pathname,
  // Signs cookies and encrypts the stored signing keys. Fixed, so sessions survive restarts.
  secret: "kotori-local-auth-development-only-secret",
  database: pool,
  emailAndPassword: { enabled: true },
  socialProviders: google,
  // The API stands in for native apps with its own origin, which is local in development too.
  // The patterns let a social sign-in name the API's `/auth/return` (port 4000) as its callback.
  trustedOrigins: (request) => {
    const origin = request?.headers.get("origin")
    return [
      ...(origin != null && isLocalOrigin(origin) ? [origin] : []),
      "http://localhost:*",
      "http://127.0.0.1:*",
      "http://10.*.*.*:*",
      "http://192.168.*.*:*",
      ...PRIVATE_172_ORIGINS
    ]
  },
  // The provider's callback reaches this server directly, without the state cookie the API's
  // proxy received: sign-in ties the flow to its browser with the session verifier's challenge
  // cookie (without silently linking onto an existing password account), and explicit linking in
  // Settings requires the Google email to match the signed-in learner's email.
  account: { skipStateCookieCheck: true, accountLinking: { disableImplicitLinking: true } },
  advanced: { database: { generateId: "uuid" }, cookiePrefix: "neonauth" },
  telemetry: { enabled: false },
  plugins: [
    sessionVerifier(),
    jwt({
      jwks: { jwksPath: "/.well-known/jwks.json" },
      jwt: { issuer: base.origin, audience: base.origin, expirationTime: "15m" }
    }),
    // Managed Auth hands codes to Kotori's webhook to email; here they go to the console.
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        console.log(`[local-auth] ${type} code for ${email}: ${otp}`)
      }
    })
  ]
} satisfies BetterAuthOptions

await pool
  .query("CREATE SCHEMA IF NOT EXISTS neon_auth")
  .catch((error: unknown) =>
    fail(`Could not reach Postgres (${String(error)}). Is it running? \`docker compose up -d --wait\` starts it.`)
  )
// Better Auth checks its tables when it starts, so they are created first.
const { runMigrations } = await getMigrations(options)
await runMigrations()

const handler = toNodeHandler(betterAuth(options))
const server = createServer((request, response) => void handler(request, response))
server.listen(Number(base.port || 80), base.hostname, () => {
  console.log(`[local-auth] Managed Auth stand-in at ${base.href}`)
})

const stop = () => {
  server.close()
  void pool.end()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
