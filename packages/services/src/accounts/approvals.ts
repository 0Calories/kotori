import type { AuthUser } from "@kotori/auth"
import { Database } from "@kotori/db"
import { users } from "@kotori/db/schema"
import type { AccountStatus } from "@kotori/domain"
import { Mailer, templates } from "@kotori/email"
import { eq, inArray } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { identities, identityByEmail, revokeSessions } from "./identity.ts"
import { emailLanguage, ensureProfile } from "./profiles.ts"

// The admin's side of the sign-up gate. Approving tells the learner by email; archiving is
// silent bookkeeping and looks like "pending" to them. Status and role live on Kotori's own
// `users` row (created here if the learner hasn't opened the app since signing up).

export class NoSuchUser extends Schema.TaggedError<NoSuchUser>()("NoSuchUser", { email: Schema.String }) {}

/** A managed auth user together with the approval state and role Kotori keeps on the profile. */
export interface Account extends AuthUser {
  readonly status: AccountStatus
  readonly role: string
}

const withProfiles = Effect.fn("accounts.withProfiles")(function* (identities: ReadonlyArray<AuthUser>) {
  if (identities.length === 0) return []
  const db = yield* Database
  const rows = yield* db
    .select({ id: users.id, status: users.status, role: users.role })
    .from(users)
    .where(
      inArray(
        users.id,
        identities.map((user) => user.id)
      )
    )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return identities.map((user): Account => ({
    ...user,
    status: byId.get(user.id)?.status ?? "pending",
    role: byId.get(user.id)?.role ?? "user"
  }))
}, Effect.orDie)

const find = Effect.fn("accounts.find")(function* (email: string) {
  const user = yield* identityByEmail(email)
  if (Option.isNone(user)) return yield* new NoSuchUser({ email })
  const [account] = yield* withProfiles([user.value])
  return account!
})

/** Every account, in sign-up order. */
export const accounts = identities.pipe(Effect.flatMap(withProfiles))

/** Pending sign-ups, oldest first; `all` includes archived ones. */
export const requests = Effect.fn("accounts.requests")(function* (options?: { readonly all?: boolean }) {
  return (yield* accounts).filter((a) => a.status === "pending" || (options?.all === true && a.status === "archived"))
})

const setStatus = (status: AccountStatus) =>
  Effect.fn(`accounts.${status}`)(function* (email: string) {
    const db = yield* Database
    const account = yield* find(email)
    if (account.status === status) return account
    const profile = yield* ensureProfile(account)
    yield* db.update(users).set({ status }).where(eq(users.id, account.id)).pipe(Effect.orDie)
    if (status === "approved") {
      yield* (yield* Mailer)
        .send(
          templates.approved({ to: account.email, name: account.name.trim() || null, language: emailLanguage(profile) })
        )
        .pipe(Effect.catchCause((cause) => Effect.logWarning("Could not send approval email", cause)))
    }
    return { ...account, status }
  })

/** Lets a learner in, and emails them to say so. */
export const approve = setStatus("approved")

/** Hides a sign-up from the requests list without telling the learner. */
export const archive = setStatus("archived")

/** Makes someone an admin (admins skip approval), or a regular learner again. */
export const setRole = Effect.fn("accounts.setRole")(function* (email: string, role: "admin" | "user") {
  const db = yield* Database
  const account = yield* find(email)
  yield* ensureProfile(account)
  yield* db.update(users).set({ role }).where(eq(users.id, account.id)).pipe(Effect.orDie)
  return { ...account, role }
})

/** Signs the learner out of every device. */
export const revoke = Effect.fn("accounts.revoke")(function* (email: string) {
  const account = yield* find(email)
  yield* revokeSessions(account.id)
  return account
})
