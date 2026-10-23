import { type UserRow, UsersRepo } from "@kotori/db"
import type { AccountStatus, Language } from "@kotori/domain"
import { Mailer, templates } from "@kotori/email"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { Auth, type AuthUser } from "./Auth.ts"

/** The language Kotori emails a learner in: the one they picked in the app, English until then. */
export const emailLanguage = (profile: UserRow | undefined): Language =>
  profile === undefined || profile.onboardedAt === null ? "en" : profile.nativeLanguage

export class NoSuchUser extends Schema.TaggedError<NoSuchUser>()("NoSuchUser", { email: Schema.String }) {}

/** A managed auth user together with the approval state and role Kotori keeps on the profile. */
export interface Account extends AuthUser {
  readonly status: AccountStatus
  readonly role: string
}

/**
 * The admin's side of the sign-up gate. Approving tells the learner by email;
 * archiving is silent bookkeeping and looks like "pending" to them.
 * Status and role live on Kotori's own `users` row (created here if the
 * learner hasn't opened the app since signing up), never in the auth system.
 */
export class Approvals extends Context.Service<
  Approvals,
  {
    /** Pending sign-ups, oldest first; `all` includes archived ones. */
    requests(options?: { readonly all?: boolean }): Effect.Effect<ReadonlyArray<Account>>
    users(): Effect.Effect<ReadonlyArray<Account>>
    approve(email: string): Effect.Effect<Account, NoSuchUser>
    archive(email: string): Effect.Effect<Account, NoSuchUser>
    setRole(email: string, role: "admin" | "user"): Effect.Effect<Account, NoSuchUser>
    /** Signs the learner out of every device. */
    revoke(email: string): Effect.Effect<Account, NoSuchUser>
  }
>()("@kotori/auth/Approvals") {
  static readonly layer = Layer.effect(
    Approvals,
    Effect.gen(function* () {
      const auth = yield* Auth
      const users = yield* UsersRepo
      const mailer = yield* Mailer

      const profileFor = (user: AuthUser) =>
        Effect.gen(function* () {
          return yield* users.ensure({
            id: user.id,
            status: "pending",
            role: "user",
            nativeLanguage: "en",
            targetLanguage: "ja",
            onboardedAt: null,
            displayName: user.name.trim() || null,
            timezone: "UTC",
            dailyNewLimit: 20,
            dailyReviewLimit: 200,
            createdAt: yield* Clock.currentTimeMillis
          })
        })

      const combine = Effect.fn("Approvals.combine")(function* (authUsers: ReadonlyArray<AuthUser>) {
        const rows = new Map((yield* users.byIds(authUsers.map((u) => u.id))).map((row) => [row.id, row]))
        return authUsers.map((user): Account => ({
          ...user,
          status: rows.get(user.id)?.status ?? "pending",
          role: rows.get(user.id)?.role ?? "user"
        }))
      })

      const find = Effect.fn("Approvals.find")(function* (email: string) {
        const user = yield* auth.userByEmail(email)
        if (Option.isNone(user)) return yield* new NoSuchUser({ email })
        const [account] = yield* combine([user.value])
        return account!
      })

      const setStatus = (status: AccountStatus) =>
        Effect.fn(`Approvals.${status}`)(function* (email: string) {
          const account = yield* find(email)
          if (account.status === status) return account
          const profile = yield* profileFor(account)
          yield* users.update(account.id, { status })
          if (status === "approved") {
            yield* mailer
              .send(
                templates.approved({
                  to: account.email,
                  name: account.name.trim() || null,
                  language: emailLanguage(profile)
                })
              )
              .pipe(Effect.catchCause((cause) => Effect.logWarning("Could not send approval email", cause)))
          }
          return { ...account, status }
        })

      return Approvals.of({
        requests: (options) =>
          auth.users.pipe(
            Effect.flatMap(combine),
            Effect.map((accounts) =>
              accounts.filter((a) => a.status === "pending" || (options?.all === true && a.status === "archived"))
            )
          ),
        users: () => auth.users.pipe(Effect.flatMap(combine)),
        approve: setStatus("approved"),
        archive: setStatus("archived"),
        setRole: Effect.fn("Approvals.setRole")(function* (email: string, role: "admin" | "user") {
          const account = yield* find(email)
          yield* profileFor(account)
          yield* users.update(account.id, { role })
          return { ...account, role }
        }),
        revoke: Effect.fn("Approvals.revoke")(function* (email: string) {
          const account = yield* find(email)
          yield* auth.revokeSessions(account.id)
          return account
        })
      })
    })
  )
}
