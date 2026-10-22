import { UsersRepo } from "@kotori/db"
import type { AccountStatus } from "@kotori/domain"
import { Mailer, templates } from "@kotori/email"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Auth, type AuthUser } from "./Auth.ts"

export class NoSuchUser extends Schema.TaggedError<NoSuchUser>()("NoSuchUser", { email: Schema.String }) {}

/**
 * Ash's side of the sign-up gate. Approving tells the learner by email;
 * archiving is silent bookkeeping and looks like "pending" to them.
 */
export class Approvals extends Context.Service<
  Approvals,
  {
    /** Pending sign-ups, oldest first; `all` includes archived ones. */
    requests(options?: { readonly all?: boolean }): Effect.Effect<ReadonlyArray<AuthUser>>
    users(): Effect.Effect<ReadonlyArray<AuthUser>>
    approve(email: string): Effect.Effect<AuthUser, NoSuchUser>
    archive(email: string): Effect.Effect<AuthUser, NoSuchUser>
    setRole(email: string, role: "admin" | "user"): Effect.Effect<AuthUser, NoSuchUser>
    /** Signs the learner out of every device. */
    revoke(email: string): Effect.Effect<AuthUser, NoSuchUser>
  }
>()("@kotori/auth/Approvals") {
  static readonly layer = Layer.effect(
    Approvals,
    Effect.gen(function* () {
      const auth = yield* Auth
      const users = yield* UsersRepo
      const mailer = yield* Mailer

      const find = Effect.fn("Approvals.find")(function* (email: string) {
        const user = yield* auth.userByEmail(email)
        if (Option.isNone(user)) return yield* new NoSuchUser({ email })
        return user.value
      })

      const setStatus = (status: AccountStatus) =>
        Effect.fn(`Approvals.${status}`)(function* (email: string) {
          const user = yield* find(email)
          if (user.status === status) return user
          const updated = yield* auth.updateUser(user.id, { status })
          if (status === "approved") {
            // Learners who already picked a language get the email in it.
            const profile = yield* users.byId(user.id)
            const language = Option.match(profile, {
              onNone: () => user.locale,
              onSome: (row) => (row.onboardedAt === null ? user.locale : row.nativeLanguage)
            })
            yield* mailer
              .send(templates.approved({ to: user.email, name: user.name.trim() || null, language }))
              .pipe(Effect.catchCause((cause) => Effect.logWarning("Could not send approval email", cause)))
          }
          return updated
        })

      return Approvals.of({
        requests: (options) => auth.users({ status: options?.all ? ["pending", "archived"] : ["pending"] }),
        users: () => auth.users(),
        approve: setStatus("approved"),
        archive: setStatus("archived"),
        setRole: Effect.fn("Approvals.setRole")(function* (email: string, role: "admin" | "user") {
          const user = yield* find(email)
          return yield* auth.updateUser(user.id, { role })
        }),
        revoke: Effect.fn("Approvals.revoke")(function* (email: string) {
          const user = yield* find(email)
          yield* auth.revokeSessions(user.id)
          return user
        })
      })
    })
  )
}
