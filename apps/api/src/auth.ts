import { expo } from "@better-auth/expo"
import { resolveFromRoot } from "@kotori/db"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { admin } from "better-auth/plugins/admin"
import { Config, Context, Effect, Layer, Option } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

/** Learners sign up freely but need approval before they can use the app. */
export type AccountStatus = "pending" | "approved" | "archived"

const DEV_SECRET = "kotori-dev-only-secret-set-BETTER_AUTH_SECRET-in-production"

const makeOptions = (settings: {
  database: DatabaseSync
  baseURL: string
  secret: string
  trustedOrigins: Array<string>
}) => ({
  appName: "Kotori",
  database: settings.database,
  baseURL: settings.baseURL,
  secret: settings.secret,
  basePath: "/api/auth",
  trustedOrigins: settings.trustedOrigins,
  emailAndPassword: {
    enabled: true,
    // Approval is the real gate; verification is encouraged but not blocking.
    requireEmailVerification: false,
    // Wired to the Mailer in the email/approval step; logs the link until then.
    sendResetPassword: async ({ url, user }: { url: string; user: { email: string } }) => {
      console.log(`[auth] password reset for ${user.email}: ${url}`)
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ url, user }: { url: string; user: { email: string } }) => {
      console.log(`[auth] verify email for ${user.email}: ${url}`)
    }
  },
  user: {
    deleteUser: { enabled: true },
    additionalFields: {
      status: {
        type: "string" as const,
        defaultValue: "pending" satisfies AccountStatus,
        input: false,
        returned: true
      }
    }
  },
  plugins: [admin(), expo()]
})

const makeAuth = (settings: Parameters<typeof makeOptions>[0]) => betterAuth(makeOptions(settings))

export type AuthInstance = ReturnType<typeof makeAuth>

/**
 * Better Auth, mounted at `/api/auth/*`. Owns identity, credentials and
 * sessions in its own database (`KOTORI_AUTH_DB_PATH`, default `data/auth.db`),
 * migrated by Better Auth itself on startup. Kotori never writes that file.
 */
export class Auth extends Context.Service<Auth, AuthInstance>()("@kotori/api/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function*() {
      const filename = yield* Config.String("KOTORI_AUTH_DB_PATH").pipe(Config.withDefault("data/auth.db"))
      const port = yield* Config.Port("KOTORI_PORT").pipe(Config.withDefault(4000))
      const baseURL = yield* Config.String("BETTER_AUTH_URL").pipe(Config.withDefault(`http://localhost:${port}`))
      const secret = yield* Config.String("BETTER_AUTH_SECRET").pipe(Config.withDefault(DEV_SECRET))
      const webOrigin = yield* Config.option(Config.String("KOTORI_WEB_ORIGIN"))

      if (secret === DEV_SECRET) {
        yield* Effect.logWarning("BETTER_AUTH_SECRET is not set; using an insecure development secret.")
      }

      const path = filename === ":memory:" ? filename : resolveFromRoot(filename)
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
      const database = new DatabaseSync(path)

      const settings = {
        database,
        baseURL,
        secret,
        trustedOrigins: [
          "kotori://",
          // Expo Go during development.
          "exp://**",
          ...Option.toArray(webOrigin)
        ]
      }

      // Better Auth owns its schema: create/update its tables on startup.
      yield* Effect.promise(async () => {
        const { runMigrations } = await getMigrations(makeOptions(settings))
        await runMigrations()
      })

      return Auth.of(makeAuth(settings))
    })
  )
}
