import { AuthUnavailable, Authorization, CurrentUser, PendingApproval, Unauthorized } from "@kotori/contracts"
import { Effect, Layer, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { Accounts } from "../features/accounts/Accounts.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import * as Sentry from "../runtime/Sentry.ts"

const OPEN_TO_PENDING = new Set(["account"])

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const auth = yield* Auth
    const accounts = yield* Accounts

    return Authorization.of(
      Effect.fn(function* (httpEffect, { group }) {
        const request = yield* HttpServerRequest.HttpServerRequest
        const bearer = request.headers["authorization"]?.match(/^Bearer\s+(.+)$/i)?.[1]
        // Return 503 rather than 401 on upstream auth failures so the client does not discard stored credentials.
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
          // Report handler errors before HttpApiBuilder catches them outside Sentry.withScope; Sentry deduplicates already-reported causes.
          Effect.withErrorReporting,
          Sentry.withScope((scope) => scope.setUser({ id: profile.id }))
        )
      })
    )
  })
)
