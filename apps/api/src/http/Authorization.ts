import { AuthUnavailable, Authorization, CurrentUser, PendingApproval, Unauthorized } from "@kotori/domain"
import { Accounts } from "@kotori/services"
import { Effect, Layer, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { withServices } from "./services.ts"

/** Groups a signed-in but unapproved learner may still call. */
const OPEN_TO_PENDING = new Set(["account"])

/**
 * Resolves the learner from either a managed JWT (`Authorization: Bearer`,
 * verified locally against the JWKS — the app's path) or the session cookie
 * (checked upstream — the web path), then applies the approval gate. When
 * Managed Auth can't be reached the answer is 503, not 401: a 401 tells the
 * app to throw its credentials away.
 */
export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const run = yield* withServices
    const signedIn = (credentials: Accounts.Credentials) =>
      Accounts.authenticate(credentials).pipe(
        Effect.mapError(
          () => new AuthUnavailable({ message: "Sign-in can't be checked right now. Try again in a moment." })
        ),
        // The profile is created on first sight, pending until an admin approves it.
        Effect.flatMap((user) =>
          Option.isNone(user) ? Effect.succeedNone : Effect.asSome(Accounts.profile(user.value))
        ),
        run
      )

    return Authorization.of(
      Effect.fn(function* (httpEffect, { group }) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const bearer = request.headers["authorization"]?.match(/^Bearer\s+(.+)$/i)?.[1]
        const profile = yield* signedIn(bearer === undefined ? { cookies: request.headers } : { token: bearer })
        if (Option.isNone(profile)) {
          return yield* new Unauthorized({ message: "Please sign in." })
        }

        const approved = profile.value.status === "approved" || profile.value.role === "admin"
        if (!approved && !OPEN_TO_PENDING.has(group.identifier)) {
          return yield* new PendingApproval({ message: "Your account is waiting for approval." })
        }

        return yield* Effect.provideService(httpEffect, CurrentUser, { id: profile.value.id, profile: profile.value })
      })
    )
  })
)
