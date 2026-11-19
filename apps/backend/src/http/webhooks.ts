import { ByteSize, Effect } from "effect"
import { HttpIncomingMessage, HttpRouter, HttpServerResponse } from "effect/http"
import { AuthWebhooks } from "../features/accounts/Webhooks.ts"

const MAX_BODY = ByteSize.kilobytes(64)

const status = (code: number) => HttpServerResponse.empty({ status: code })

// Neon Auth retries webhooks only on 429 and 5xx, so map upstream JWKS/mail outages to 5xx and permanent signature/payload failures to 4xx.
export const WebhooksRoute = HttpRouter.add("POST", "/webhooks/neon-auth", (request) =>
  Effect.gen(function* () {
    const webhooks = yield* AuthWebhooks
    const body = new Uint8Array(yield* request.arrayBuffer)
    yield* webhooks.receive(request.headers, body)
    return status(204)
  }).pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, MAX_BODY),
    Effect.catchTags({
      HttpServerError: () => Effect.succeed(status(400)),
      WebhookRejected: () => Effect.succeed(status(401)),
      WebhookUnusable: () => Effect.succeed(status(422)),
      AuthUpstreamError: () => Effect.succeed(status(503)),
      MailError: () => Effect.succeed(status(502))
    })
  )
)
