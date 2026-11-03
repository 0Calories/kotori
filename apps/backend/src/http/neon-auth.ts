import { Effect } from "effect"
import { HttpRouter } from "effect/http"
import { Auth } from "../integrations/auth/Auth.ts"

const PREFIX = "/api/auth"

/**
 * Sign-up, sign-in, sessions, verification, password reset and account deletion,
 * handled by Neon's Managed Better Auth and proxied here so the app talks to one
 * origin and its cookies come from the API.
 */
export const AuthRoute = HttpRouter.add("*", `${PREFIX}/*`, (request) =>
  Effect.flatMap(Auth, (auth) => auth.forward(request, request.url.slice(PREFIX.length) || "/"))
)
