import { Authorization, CurrentUser, PendingApproval, Unauthorized } from "@kotori/domain"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { Auth } from "../auth.ts"
import { Accounts } from "../services/Accounts.ts"

/** Groups a signed-in but unapproved learner may still call. */
const OPEN_TO_PENDING = new Set(["account"])

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function*() {
    const auth = yield* Auth
    const accounts = yield* Accounts

    return Authorization.of(Effect.fn(function*(httpEffect, { group }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const session = yield* Effect.promise(() =>
        auth.api.getSession({ headers: new Headers(request.headers as Record<string, string>) })
      )
      if (session === null) {
        return yield* new Unauthorized({ message: "Please sign in." })
      }

      const profile = yield* accounts.profile(session.user)
      const approved = profile.status === "approved" || profile.role === "admin"
      if (!approved && !OPEN_TO_PENDING.has(group.identifier)) {
        return yield* new PendingApproval({ message: "Your account is waiting for approval." })
      }

      return yield* Effect.provideService(httpEffect, CurrentUser, { id: profile.id, profile })
    }))
  })
)
