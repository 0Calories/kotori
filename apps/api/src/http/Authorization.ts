import { Auth } from "@kotori/auth"
import { Authorization, CurrentUser, PendingApproval, Unauthorized } from "@kotori/domain"
import { Effect, Layer, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { Accounts } from "../services/Accounts.ts"

/** Groups a signed-in but unapproved learner may still call. */
const OPEN_TO_PENDING = new Set(["account"])

/**
 * Resolves the learner from either a managed JWT (`Authorization: Bearer`,
 * verified locally against the JWKS — the app's path) or the session cookie
 * (checked upstream — the web path), then applies the approval gate.
 */
export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* Auth
    const accounts = yield* Accounts

    return Authorization.of(
      Effect.fn(function* (httpEffect, { group }) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const bearer = request.headers["authorization"]?.match(/^Bearer\s+(.+)$/i)?.[1]
        const user =
          bearer === undefined ? yield* auth.sessionFromCookies(request.headers) : yield* auth.verifyToken(bearer)
        if (Option.isNone(user)) {
          return yield* new Unauthorized({ message: "Please sign in." })
        }

        const profile = yield* accounts.profile(user.value)
        const approved = profile.status === "approved" || profile.role === "admin"
        if (!approved && !OPEN_TO_PENDING.has(group.identifier)) {
          return yield* new PendingApproval({ message: "Your account is waiting for approval." })
        }

        return yield* Effect.provideService(httpEffect, CurrentUser, { id: profile.id, profile })
      })
    )
  })
)
