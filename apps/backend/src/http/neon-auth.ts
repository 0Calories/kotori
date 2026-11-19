import { Effect } from "effect"
import { HttpRouter } from "effect/http"
import { Auth } from "../integrations/auth/Auth.ts"

const PREFIX = "/api/auth"

// Proxy Managed Better Auth under the API origin so web session cookies stay first-party.
export const AuthRoute = HttpRouter.add("*", `${PREFIX}/*`, (request) =>
  Effect.flatMap(Auth, (auth) => auth.forward(request, request.url.slice(PREFIX.length) || "/"))
)
