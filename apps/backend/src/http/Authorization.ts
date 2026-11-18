import { AuthUnavailable, Authorization, CurrentUser, PendingApproval, Unauthorized } from "@kotori/contracts"
import { Effect, Layer, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { Accounts } from "../features/accounts/Accounts.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import * as Sentry from "../runtime/Sentry.ts"

/** Groups a signed-in but unapproved learner may still call. */
const OPEN_TO_PENDING = new Set(["account"])

/**
 * Resolves the learner from either a managed JWT (`Authorization: Bearer`,
 * verified locally against the JWKS — the app's path) or the session cookie
 * (checked upstream — the web path), then applies the approval gate. When
 * Managed Auth can't be reached the answer is 503, not 401: a 401 tells the
 * app to throw its credentials away.
 *
 * The learner's id (only the id) tags the request's span and everything Sentry captures while the
 * handler runs — errors, logs and spans — and nothing from other requests.
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
        const user = yield* (
          bearer === undefined ? auth.sessionFromCookies(request.headers) : auth.verifyToken(bearer)
        ).pipe(
          Effect.mapError(
            () => new AuthUnavailable({ message: "Sign-in can't be checked right now. Try again in a moment." })
          )
        )
        if (Option.isNone(user)) {
          return yield* new Unauthorized({ message: "Please sign in." })
        }

        const profile = yield* accounts.profile(user.value)
        const approved = profile.status === "approved" || profile.role === "admin"
        if (!approved && !OPEN_TO_PENDING.has(group.identifier)) {
          return yield* new PendingApproval({ message: "Your account is waiting for approval." })
        }

        yield* Effect.annotateCurrentSpan("user.id", profile.id)
        return yield* httpEffect.pipe(
          Effect.provideService(CurrentUser, { id: profile.id, profile }),
          // `HttpApiBuilder` reports the handler's failures outside this middleware, where the scope
          // no longer applies. Reporting them here first puts them in the scope; the Sentry reporter
          // skips a cause or error it has already reported, so each is still sent once.
          Effect.withErrorReporting,
          Sentry.withScope((scope) => scope.setUser({ id: profile.id }))
        )
      })
    )
  })
)
