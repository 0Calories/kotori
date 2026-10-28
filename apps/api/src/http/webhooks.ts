import { Accounts } from "@kotori/services"
import { ByteSize, Effect } from "effect"
import { HttpIncomingMessage, HttpRouter, HttpServerResponse } from "effect/http"

/** Neon's payloads are a few hundred bytes; anything this large isn't one. */
const MAX_BODY = ByteSize.kilobytes(64)

const status = (code: number) => HttpServerResponse.empty({ status: code })

/**
 * Managed Better Auth's webhooks (`send.otp`, `send.magic_link`), registered with
 * `neon neon-auth config webhook update` (docs/deploy.md §4). Neon ignores the body
 * of the answer and retries 5xx and 429, not other 4xx: an unverifiable request is a
 * final 401, while an outage of the key set or of Resend is a 5xx worth retrying.
 */
export const WebhooksRoute = HttpRouter.add("POST", "/webhooks/neon-auth", (request) =>
  Effect.gen(function* () {
    const body = new Uint8Array(yield* request.arrayBuffer)
    yield* Accounts.deliverAuthEmail(request.headers, body)
    return status(204)
  }).pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, MAX_BODY),
    Effect.catchTags({
      // The body couldn't be read: too large, or the connection went away.
      HttpServerError: () => Effect.succeed(status(400)),
      WebhookRejected: () => Effect.succeed(status(401)),
      WebhookUnusable: () => Effect.succeed(status(422)),
      AuthUpstreamError: () => Effect.succeed(status(503)),
      MailError: () => Effect.succeed(status(502))
    })
  )
)
