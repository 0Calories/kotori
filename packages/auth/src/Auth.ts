import { expo } from "@better-auth/expo"
import { UsersRepo } from "@kotori/db"
import { AccountStatus, Language } from "@kotori/domain"
import { Mailer, templates } from "@kotori/email"
import { isProduction } from "@kotori/runtime"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { admin } from "better-auth/plugins/admin"
import { Config, Context, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { Kysely } from "kysely"
import { SqlClientDialect } from "./SqlClientDialect.ts"

const DEV_SECRET = "kotori-dev-only-secret-set-BETTER_AUTH_SECRET-in-production"

/** A Better Auth user as Kotori reads it. */
export interface AuthUser {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
  readonly name: string
  /** Unknown or missing statuses count as pending. */
  readonly status: AccountStatus
  readonly role: string
  /** Interface language chosen at sign-up; emails use it until the learner picks a language. */
  readonly locale: Language
  readonly createdAt: Date
}

const RawUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  name: Schema.String,
  status: Schema.optional(Schema.Unknown),
  role: Schema.optional(Schema.NullOr(Schema.String)),
  locale: Schema.optional(Schema.Unknown),
  createdAt: Schema.Date
})
const decodeRaw = Schema.decodeUnknownSync(RawUser)
const decodeStatus = Schema.decodeUnknownOption(AccountStatus)
const decodeLanguage = Schema.decodeUnknownOption(Language)

const decodeUser = (raw: unknown): AuthUser => {
  const user = decodeRaw(raw)
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    status: Option.getOrElse(decodeStatus(user.status), () => "pending" as const),
    role: user.role ?? "user",
    locale: Option.getOrElse(decodeLanguage(user.locale), () => "en" as const),
    createdAt: user.createdAt
  }
}

interface Settings {
  readonly database: Kysely<unknown>
  readonly baseURL: string
  readonly secret: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly sendMail: (email: { to: string; subject: string; text: string; html: string }) => Promise<void>
  /** Called after Better Auth deletes a user, so Kotori can drop their profile and study data. */
  readonly onUserDeleted: (userId: string) => Promise<void>
}

const recipient = (user: { email: string; name: string; locale?: unknown }) => ({
  to: user.email,
  name: user.name.trim() || null,
  language: Option.getOrElse(decodeLanguage(user.locale), () => "en" as const)
})

const makeOptions = (settings: Settings) => ({
  appName: "Kotori",
  database: { db: settings.database, type: "postgres" as const },
  baseURL: settings.baseURL,
  secret: settings.secret,
  basePath: "/api/auth",
  trustedOrigins: [...settings.trustedOrigins],
  emailAndPassword: {
    enabled: true,
    // Approval is the real gate; verification is encouraged but not blocking.
    requireEmailVerification: false,
    sendResetPassword: async ({ url, user }: { url: string; user: { email: string; name: string } }) => {
      await settings.sendMail(templates.resetPassword(recipient(user), url))
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ url, user }: { url: string; user: { email: string; name: string } }) => {
      await settings.sendMail(templates.verifyEmail(recipient(user), url))
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
      },
      locale: {
        type: "string" as const,
        defaultValue: "en" satisfies Language,
        input: true,
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
  /** Users in sign-up order, optionally filtered by status. */
  users(filter?: { readonly status?: ReadonlyArray<AccountStatus> }): Effect.Effect<ReadonlyArray<AuthUser>>
  userByEmail(email: string): Effect.Effect<Option.Option<AuthUser>>
  /** Approve or archive a sign-up, or change a role. Learners can't change these themselves. */
  updateUser(userId: string, patch: { status?: AccountStatus; role?: string }): Effect.Effect<AuthUser>
  /** Signs the user out everywhere. */
  revokeSessions(userId: string): Effect.Effect<void>
}

/**
 * Better Auth, mounted at `/api/auth/*`. Owns identity, credentials and sessions
 * in its own tables (`user`, `session`, `account`, `verification`) of Kotori's
 * database, created and migrated by Better Auth itself on startup. Kotori never
 * writes those tables directly; everything goes through this service.
 */
export class Auth extends Context.Service<Auth, AuthService>()("@kotori/auth/Auth") {
  private static make = Effect.fn("Auth.make")(function* (
    settings: Omit<Settings, "database" | "onUserDeleted" | "sendMail">
  ) {
    const sql = yield* SqlClient.SqlClient
    const users = yield* UsersRepo
    const mailer = yield* Mailer
    const full: Settings = {
      ...settings,
      database: new Kysely({ dialect: new SqlClientDialect(sql) }),
      sendMail: (email) => Effect.runPromise(mailer.send(email).pipe(Effect.orDie)),
      onUserDeleted: (userId) => Effect.runPromise(users.delete(userId))
    }

    // Better Auth owns its schema: create/update its tables on startup. The API and
    // the worker may start at the same moment; if both find a table missing, one
    // CREATE fails and the retry sees the other's work.
    yield* Effect.tryPromise(async () => {
      const { runMigrations } = await getMigrations(makeOptions(full))
      await runMigrations()
    }).pipe(Effect.retry({ times: 3, schedule: Schedule.spaced("1 second") }), Effect.orDie)

    const auth = makeAuth(full)
    const context = Effect.promise(() => auth.$context)

    const list = (filter?: { readonly status?: ReadonlyArray<AccountStatus> }) =>
      Effect.gen(function* () {
        const ctx = yield* context
        const where =
          filter?.status === undefined
            ? undefined
            : [{ field: "status", operator: "in" as const, value: [...filter.status] }]
        const rows = yield* Effect.promise(() =>
          ctx.internalAdapter.listUsers(undefined, undefined, { field: "createdAt", direction: "asc" }, where)
        )
        return rows.map(decodeUser)
      })

    const userByEmail = (email: string) =>
      Effect.gen(function* () {
        const ctx = yield* context
        const found = yield* Effect.promise(() => ctx.internalAdapter.findUserByEmail(email.trim().toLowerCase()))
        return Option.fromNullishOr(found?.user).pipe(Option.map(decodeUser))
      })

    const updateUser = (userId: string, patch: { status?: AccountStatus; role?: string }) =>
      Effect.gen(function* () {
        const ctx = yield* context
        const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
        return decodeUser(yield* Effect.promise(() => ctx.internalAdapter.updateUser(userId, fields)))
      })

    const revokeSessions = (userId: string) =>
      Effect.gen(function* () {
        const ctx = yield* context
        const sessions = yield* Effect.promise(() => ctx.internalAdapter.listSessions(userId))
        yield* Effect.promise(() => ctx.internalAdapter.deleteSessions(sessions.map((s) => s.token)))
      })

    return Auth.of({ api: auth.api, handler: auth.handler, users: list, userByEmail, updateUser, revokeSessions })
  })

  /**
   * Configured from the environment, over the `SqlClient` in context. In production
   * `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are required and startup fails without
   * them; elsewhere a known development secret and `http://localhost:<port>` stand in.
   */
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const production = yield* isProduction
      const port = yield* Config.Port("KOTORI_PORT").pipe(Config.withDefault(4000))
      const webOrigin = yield* Config.option(Config.String("KOTORI_WEB_ORIGIN"))

      const baseURL = yield* production
        ? Config.String("BETTER_AUTH_URL")
        : Config.String("BETTER_AUTH_URL").pipe(Config.withDefault(`http://localhost:${port}`))
      const secret = yield* production
        ? Config.Redacted("BETTER_AUTH_SECRET").pipe(Config.map(Redacted.value))
        : Config.String("BETTER_AUTH_SECRET").pipe(Config.withDefault(DEV_SECRET))

      if (secret === DEV_SECRET) {
        yield* Effect.logWarning("BETTER_AUTH_SECRET is not set; using an insecure development secret.")
      }

      return yield* Auth.make({
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

  /** Fixed development settings over whatever `SqlClient` the test provides. */
  static readonly layerTest = Layer.effect(
    Auth,
    Auth.make({ baseURL: "http://localhost:4000", secret: DEV_SECRET, trustedOrigins: [] })
  )
}
