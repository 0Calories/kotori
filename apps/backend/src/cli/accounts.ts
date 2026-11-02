import { type Account, Approvals, Auth } from "@kotori/auth"
import { UsersRepo } from "@kotori/db"
import type { Language } from "@kotori/domain"
import { Clock, Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

const email = Argument.String("email").pipe(Argument.withDescription("The learner's email address"))

const line = (user: Account) =>
  [
    user.email.padEnd(32),
    user.status.padEnd(9),
    (user.emailVerified ? "verified" : "unverified").padEnd(11),
    user.role.padEnd(6),
    user.createdAt.toISOString().slice(0, 10),
    user.name
  ].join("  ")

const table = (users: ReadonlyArray<Account>, empty: string) =>
  users.length === 0 ? Console.log(empty) : Effect.forEach(users, (user) => Console.log(line(user)), { discard: true })

const notFound = (email: string) => Console.error(`No account with the email ${email}.`)

/** Sign-ups waiting for the admin. */
export const requests = Command.make(
  "requests",
  { all: Flag.Boolean("all").pipe(Flag.withDescription("Include archived requests"), Flag.withDefault(false)) },
  Effect.fn(function* ({ all }) {
    const approvals = yield* Approvals
    yield* table(yield* approvals.requests({ all }), all ? "No pending or archived requests." : "No pending requests.")
  })
).pipe(Command.withDescription("List sign-ups waiting for approval"))

export const approve = Command.make(
  "approve",
  { email },
  Effect.fn(function* ({ email }) {
    const approvals = yield* Approvals
    yield* approvals.approve(email).pipe(
      Effect.flatMap((user) => Console.log(`Approved ${user.email}; they've been emailed.`)),
      Effect.catchTag("NoSuchUser", () => notFound(email))
    )
  })
).pipe(Command.withDescription("Approve a sign-up and email the learner"))

export const archive = Command.make(
  "archive",
  { email },
  Effect.fn(function* ({ email }) {
    const approvals = yield* Approvals
    yield* approvals.archive(email).pipe(
      Effect.flatMap((user) =>
        Console.log(`Archived ${user.email}. Nothing was sent; approve later with \`kotori approve\`.`)
      ),
      Effect.catchTag("NoSuchUser", () => notFound(email))
    )
  })
).pipe(Command.withDescription("Hide a sign-up from the requests list without telling the learner"))

export const users = Command.make(
  "users",
  {},
  Effect.fn(function* () {
    const approvals = yield* Approvals
    yield* table(yield* approvals.users(), "No accounts yet.")
  })
).pipe(Command.withDescription("List every account"))

export const adminCommand = Command.make(
  "admin",
  {
    email,
    remove: Flag.Boolean("remove").pipe(
      Flag.withDescription("Demote back to a regular learner"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ email, remove }) {
    const approvals = yield* Approvals
    yield* approvals.setRole(email, remove ? "user" : "admin").pipe(
      Effect.flatMap((user) => Console.log(`${user.email} is now ${remove ? "a learner" : "an admin"}.`)),
      Effect.catchTag("NoSuchUser", () => notFound(email))
    )
  })
).pipe(Command.withDescription("Make someone an admin (admins skip approval)"))

export const revoke = Command.make(
  "revoke",
  { email },
  Effect.fn(function* ({ email }) {
    const approvals = yield* Approvals
    yield* approvals.revoke(email).pipe(
      Effect.flatMap((user) => Console.log(`Signed ${user.email} out everywhere.`)),
      Effect.catchTag("NoSuchUser", () => notFound(email))
    )
  })
).pipe(Command.withDescription("Sign a learner out of every device"))

/**
 * The development account the app signs in as, so testing skips sign-up, the
 * confirmation code and waiting for approval. Creating it is idempotent.
 *
 * Repeated in `apps/app/src/auth/dev.ts` rather than shared through a package, so
 * that the app's copy can be folded out of release builds. Keep the two in step.
 */
const DEV_EMAIL = "dev@kotori.test"
const DEV_PASSWORD = "kotori-dev-account"

export const devAccount = Command.make(
  "dev-account",
  {
    email: Flag.String("email").pipe(Flag.withDescription("Address to use"), Flag.withDefault(DEV_EMAIL)),
    password: Flag.String("password").pipe(Flag.withDescription("Password to set"), Flag.withDefault(DEV_PASSWORD)),
    language: Flag.String("language").pipe(
      Flag.withDescription("Native language: en (learning Japanese) or ja (learning English)"),
      Flag.withDefault("en")
    ),
    admin: Flag.Boolean("admin").pipe(
      Flag.withDescription("Make the account an admin as well as approved"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ email, password, language, admin }) {
    // This writes a known password into the identity store, so it must not reach production.
    if (process.env["NODE_ENV"] === "production") {
      return yield* Console.error("Refusing to create a development account with NODE_ENV=production.")
    }
    if (language !== "en" && language !== "ja") {
      return yield* Console.error(`--language must be en or ja, not ${language}.`)
    }
    const nativeLanguage: Language = language
    const targetLanguage: Language = language === "en" ? "ja" : "en"

    const auth = yield* Auth
    const users = yield* UsersRepo
    const existing = yield* auth.userByEmail(email)
    const user = Option.isSome(existing) ? existing.value : yield* auth.signUp({ email, password, name: "Dev Learner" })
    yield* Console.log(Option.isSome(existing) ? `Reusing ${user.email}.` : `Created ${user.email}.`)

    // Confirmed, approved and past the language picker, so the app opens onto the tabs.
    // `ensure` then `update`, so an account left over from an earlier run is reset too.
    yield* auth.setEmailVerified(user.id)
    const now = yield* Clock.currentTimeMillis
    const role = admin ? "admin" : "user"
    yield* users.ensure({
      id: user.id,
      status: "approved",
      role,
      nativeLanguage,
      targetLanguage,
      onboardedAt: now,
      displayName: user.name.trim() || null,
      timezone: "UTC",
      dailyNewLimit: 20,
      dailyReviewLimit: 200,
      createdAt: now
    })
    yield* users.update(user.id, { status: "approved", role, nativeLanguage, targetLanguage, onboardedAt: now })

    yield* Console.log(
      `Ready: ${email} / ${password} — confirmed, approved${admin ? ", admin" : ""}, learning ` +
        `${language === "en" ? "Japanese" : "English"}. The app signs in as this account in development.`
    )
  })
).pipe(Command.withDescription("Create (or repair) the local development account the app signs in as"))
