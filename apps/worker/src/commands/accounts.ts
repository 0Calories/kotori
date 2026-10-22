import { Approvals, type AuthUser } from "@kotori/auth"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"

const email = Argument.String("email").pipe(Argument.withDescription("The learner's email address"))

const line = (user: AuthUser) =>
  [
    user.email.padEnd(32),
    user.status.padEnd(9),
    (user.emailVerified ? "verified" : "unverified").padEnd(11),
    user.role.padEnd(6),
    user.createdAt.toISOString().slice(0, 10),
    user.name
  ].join("  ")

const table = (users: ReadonlyArray<AuthUser>, empty: string) =>
  users.length === 0 ? Console.log(empty) : Effect.forEach(users, (user) => Console.log(line(user)), { discard: true })

const notFound = (email: string) => Console.error(`No account with the email ${email}.`)

/** Sign-ups waiting for Ash. */
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
