import { Accounts } from "@kotori/services"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"

const email = Argument.String("email").pipe(Argument.withDescription("The learner's email address"))

const line = (user: Accounts.Account) =>
  [
    user.email.padEnd(32),
    user.status.padEnd(9),
    (user.emailVerified ? "verified" : "unverified").padEnd(11),
    user.role.padEnd(6),
    user.createdAt.toISOString().slice(0, 10),
    user.name
  ].join("  ")

const table = (users: ReadonlyArray<Accounts.Account>, empty: string) =>
  users.length === 0 ? Console.log(empty) : Effect.forEach(users, (user) => Console.log(line(user)), { discard: true })

const notFound = (email: string) => Console.error(`No account with the email ${email}.`)

/** Sign-ups waiting for the admin. */
export const requests = Command.make(
  "requests",
  { all: Flag.Boolean("all").pipe(Flag.withDescription("Include archived requests"), Flag.withDefault(false)) },
  Effect.fn(function* ({ all }) {
    yield* table(yield* Accounts.requests({ all }), all ? "No pending or archived requests." : "No pending requests.")
  })
).pipe(Command.withDescription("List sign-ups waiting for approval"))

export const approve = Command.make(
  "approve",
  { email },
  Effect.fn(function* ({ email }) {
    yield* Accounts.approve(email).pipe(
      Effect.flatMap((user) => Console.log(`Approved ${user.email}; they've been emailed.`)),
      Effect.catchTag("NoSuchUser", () => notFound(email))
    )
  })
).pipe(Command.withDescription("Approve a sign-up and email the learner"))

export const archive = Command.make(
  "archive",
  { email },
  Effect.fn(function* ({ email }) {
    yield* Accounts.archive(email).pipe(
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
    yield* table(yield* Accounts.accounts, "No accounts yet.")
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
    yield* Accounts.setRole(email, remove ? "user" : "admin").pipe(
      Effect.flatMap((user) => Console.log(`${user.email} is now ${remove ? "a learner" : "an admin"}.`)),
      Effect.catchTag("NoSuchUser", () => notFound(email))
    )
  })
).pipe(Command.withDescription("Make someone an admin (admins skip approval)"))

export const revoke = Command.make(
  "revoke",
  { email },
  Effect.fn(function* ({ email }) {
    yield* Accounts.revoke(email).pipe(
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
    const { user, created } = yield* Accounts.ensureDevAccount({ email, password, nativeLanguage: language, admin })
    yield* Console.log(created ? `Created ${user.email}.` : `Reusing ${user.email}.`)
    yield* Console.log(
      `Ready: ${email} / ${password} — confirmed, approved${admin ? ", admin" : ""}, learning ` +
        `${language === "en" ? "Japanese" : "English"}. The app signs in as this account in development.`
    )
  })
).pipe(Command.withDescription("Create (or repair) the local development account the app signs in as"))
