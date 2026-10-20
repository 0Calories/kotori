import { expo } from "@better-auth/expo"
import { resolveFromRoot, UsersRepo } from "@kotori/db"
import type { AccountStatus } from "@kotori/domain"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { admin } from "better-auth/plugins/admin"
import { Config, Context, Effect, Layer, Option } from "effect"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

const DEV_SECRET = "kotori-dev-only-secret-set-BETTER_AUTH_SECRET-in-production"

interface Settings {
  readonly database: DatabaseSync
  readonly baseURL: string
  readonly secret: string
  readonly trustedOrigins: ReadonlyArray<string>
  /** Called after Better Auth deletes a user, so Kotori can drop their profile and study data. */
  readonly onUserDeleted: (userId: string) => Promise<void>
}

const makeOptions = (settings: Settings) => ({
  appName: "Kotori",
  database: settings.database,
  baseURL: settings.baseURL,
  secret: settings.secret,
  basePath: "/api/auth",
  trustedOrigins: [...settings.trustedOrigins],
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
  databaseHooks: {
    user: {
      delete: {
        after: async (user: { id: string }) => settings.onUserDeleted(user.id)
      }
    }
  },
  plugins: [admin(), expo()]
})

const makeAuth = (settings: Settings) => betterAuth(makeOptions(settings))

export type AuthInstance = ReturnType<typeof makeAuth>

export interface AuthService {
  readonly api: AuthInstance["api"]
  readonly handler: AuthInstance["handler"]
  /** Approve or archive a signup. Used by the CLI; learners can't change this themselves. */
  setStatus(userId: string, status: AccountStatus): Effect.Effect<void>
}

/**
 * Better Auth, mounted at `/api/auth/*`. Owns identity, credentials and
 * sessions in its own database, migrated by Better Auth itself on startup.
 * Kotori never writes that file.
 */
export class Auth extends Context.Service<Auth, AuthService>()("@kotori/api/Auth") {
  private static make = Effect.fn("Auth.make")(function*(
    settings: Omit<Settings, "onUserDeleted">
  ) {
    const users = yield* UsersRepo
    const full: Settings = {
      ...settings,
      onUserDeleted: (userId) => Effect.runPromise(users.delete(userId))
    }

    // Better Auth owns its schema: create/update its tables on startup.
    yield* Effect.promise(async () => {
      const { runMigrations } = await getMigrations(makeOptions(full))
      await runMigrations()
    })

    const auth = makeAuth(full)

    const setStatus = (userId: string, status: AccountStatus) =>
      Effect.promise(async () => {
        const context = await auth.$context
        await context.internalAdapter.updateUser(userId, { status })
      })

    return Auth.of({ api: auth.api, handler: auth.handler, setStatus })
  })

  /** Configured from the environment; the database at `KOTORI_AUTH_DB_PATH` (default `data/auth.db`). */
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

      return yield* Auth.make({
        database: new DatabaseSync(path),
        baseURL,
        secret,
        trustedOrigins: [
          "kotori://",
          // Expo Go during development.
          "exp://**",
          ...Option.toArray(webOrigin)
        ]
      })
    })
  )

  /** A fresh in-memory auth database, for tests. */
  static readonly layerMemory = Layer.effect(
    Auth,
    Auth.make({
      database: new DatabaseSync(":memory:"),
      baseURL: "http://localhost:4000",
      secret: DEV_SECRET,
      trustedOrigins: []
    })
  )
}
