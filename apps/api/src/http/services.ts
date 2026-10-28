import type { ServicesContext } from "@kotori/services"
import { Effect } from "effect"

/**
 * Runs use cases from handlers and middleware, which may only require what the request
 * provides (`CurrentUser`): each takes the services' context once, when its layer is built.
 */
export const withServices = Effect.map(
  Effect.context<ServicesContext>(),
  (context) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.provideContext(effect, context)
)
