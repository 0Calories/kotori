import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { toNodeHandler } from "better-auth/node"
import { emailOTP } from "better-auth/plugins/email-otp"
import { jwt } from "better-auth/plugins/jwt"
import { statSync } from "node:fs"
import { createServer } from "node:http"
import pg from "pg"
import { isLocalHost, remoteDatabaseHost } from "./localHost.ts"
import { sessionVerifier } from "./sessionVerifier.ts"

// 1Password Environment FIFOs block concurrent readers, and Nx has already loaded them into `process.env`.
const nxLoadedDotEnv =
  process.env["NX_TASK_TARGET_PROJECT"] !== undefined && process.env["NX_LOAD_DOT_ENV_FILES"] !== "false"
for (const file of [".env.local", ".env"]) {
  try {
    const url = new URL(`../../../${file}`, import.meta.url)
    if (nxLoadedDotEnv && statSync(url).isFIFO()) continue
    process.loadEnvFile(url)
  } catch {}
}

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
if (base.protocol !== "http:" || !isLocalHost(base.hostname)) {
  console.log(`[local-auth] NEON_AUTH_BASE_URL points at ${base.host}, so the local auth server isn't needed.`)
  process.exit(0)
}

const databaseUrl = process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori"
const remoteDatabase = remoteDatabaseHost(databaseUrl)
if (remoteDatabase !== undefined) {
  fail(`DATABASE_URL points at ${remoteDatabase}, not this machine, and the local auth server only runs against a local database.
  Point DATABASE_URL at the local one (the line in .env.example), or NEON_AUTH_BASE_URL at the Neon branch that database belongs to.`)
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  options: "-c search_path=neon_auth"
})

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
  secret: "kotori-local-auth-development-only-secret",
  database: pool,
  emailAndPassword: { enabled: true },
  socialProviders: google,
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
  // OAuth callbacks hit this server directly without the API proxy's state cookie; `sessionVerifier` binds the flow instead.
  account: { skipStateCookieCheck: true, accountLinking: { disableImplicitLinking: true } },
  advanced: { database: { generateId: "uuid" }, cookiePrefix: "neonauth" },
  telemetry: { enabled: false },
  plugins: [
    sessionVerifier(),
    jwt({
      jwks: { jwksPath: "/.well-known/jwks.json" },
      jwt: { issuer: base.origin, audience: base.origin, expirationTime: "15m" }
    }),
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
const { runMigrations } = await getMigrations(options)
await runMigrations()

const handler = toNodeHandler(betterAuth(options))
const server = createServer((request, response) => void handler(request, response))
server.listen(Number(base.port || 80), base.hostname.replace(/^\[(.*)\]$/, "$1"), () => {
  console.log(`[local-auth] Managed Auth stand-in at ${base.href}`)
})

const stop = () => {
  server.close()
  void pool.end()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
