import { Authorization, CurrentUser, Unauthorized } from "@kotori/domain"
import { Effect, Layer, Option, Redacted } from "effect"
import { Accounts } from "../services/Accounts.ts"

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function*() {
    const accounts = yield* Accounts
    return Authorization.of({
      bearer: Effect.fn(function*(httpEffect, { credential }) {
        const profile = yield* accounts.authenticate(Redacted.value(credential))
        if (Option.isNone(profile)) {
          return yield* new Unauthorized({ message: "Your session has expired. Please restart Kotori." })
        }
        return yield* Effect.provideService(httpEffect, CurrentUser, { id: profile.value.id, profile: profile.value })
      })
    })
  })
)
