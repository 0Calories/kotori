import { Effect } from "effect"
import { HttpEffect, HttpRouter } from "effect/http"
import { Auth } from "@kotori/auth"

/** Sign-up, sign-in, sessions, verification and password reset, handled by Better Auth. */
export const BetterAuthRoute = HttpRouter.add(
  "*",
  "/api/auth/*",
  Effect.gen(function*() {
    const auth = yield* Auth
    return yield* HttpEffect.fromWebHandler(auth.handler)
  })
)
