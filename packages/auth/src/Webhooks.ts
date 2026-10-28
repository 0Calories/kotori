import { Clock, Duration, Effect, Option, Schema } from "effect"
import type { Headers } from "effect/http"
import { Auth } from "./Auth.ts"
import { signatureIsValid } from "./WebhookSignature.ts"

/** Neon's replay window: a correctly signed request older than this is still turned away. */
const MAX_AGE = Duration.minutes(5)

/** Not provably from Managed Auth (headers, signature, key or age). Nothing is sent. */
export class WebhookRejected extends Schema.TaggedError<WebhookRejected>()("WebhookRejected", {
  reason: Schema.String
}) {}

/** Signed by Managed Auth but not deliverable here: no address, an SMS code, an unknown type. */
export class WebhookUnusable extends Schema.TaggedError<WebhookUnusable>()("WebhookUnusable", {
  reason: Schema.String
}) {}

const Purpose = Schema.Literals(["email-verification", "forget-password", "sign-in"])

/** The envelope every event shares (docs/auth/guides/webhooks, "Payload structure"); user fields are optional. */
const Envelope = Schema.Struct({
  event_id: Schema.String,
  event_type: Schema.String,
  user: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      name: Schema.optional(Schema.NullOr(Schema.String))
    })
  ),
  event_data: Schema.optional(Schema.Unknown)
})
const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(Envelope))

const OtpData = Schema.Struct({
  otp_code: Schema.String,
  otp_type: Purpose,
  delivery_preference: Schema.optional(Schema.Literals(["email", "sms"]))
})
const MagicLinkData = Schema.Struct({ link_type: Purpose, link_url: Schema.String })

/** A code or link Managed Auth wants emailed, from a verified `send.otp` or `send.magic_link`. */
export interface OneTimeEmail {
  /** Neon's id for the event, the same on every retry of it. */
  readonly eventId: string
  readonly purpose: typeof Purpose.Type
  readonly secret: { readonly code: string } | { readonly url: string }
  readonly to: string
  readonly userId: string | undefined
  readonly name: string | null
}

/**
 * Managed Better Auth's `send.otp` and `send.magic_link` webhooks, which replace its
 * own emails. Fails closed: unless the signature verifies against Managed Auth's keys
 * and the request is fresh, the body isn't even parsed. Other event types are verified
 * and answered with none. Sending the email is the caller's.
 */
export const verifyWebhook = Effect.fn("AuthWebhooks.verify")(function* (headers: Headers.Headers, body: Uint8Array) {
  const auth = yield* Auth
  const reject = (reason: string) => Effect.fail(new WebhookRejected({ reason }))
  const unusable = (reason: string) => Effect.fail(new WebhookUnusable({ reason }))

  const signature = headers["x-neon-signature"]
  const kid = headers["x-neon-signature-kid"]
  const timestamp = headers["x-neon-timestamp"]
  if (signature === undefined || kid === undefined || timestamp === undefined) {
    return yield* reject("missing signature headers")
  }
  if (!/^\d{1,16}$/.test(timestamp)) return yield* reject("malformed timestamp")
  const key = yield* auth.webhookKey(kid)
  if (Option.isNone(key)) return yield* reject(`no Ed25519 key ${kid} in the key set`)
  if (!signatureIsValid(body, signature, timestamp, key.value)) return yield* reject("bad signature")
  if ((yield* Clock.currentTimeMillis) - Number(timestamp) > Duration.toMillis(MAX_AGE)) {
    return yield* reject("timestamp too old")
  }
  // Only now is the body Neon's; parse it, not re-serialise it.
  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(body),
    catch: () => new WebhookUnusable({ reason: "body is not UTF-8" })
  })
  const event = yield* decodeEnvelope(text).pipe(
    Effect.mapError((error) => new WebhookUnusable({ reason: `unexpected payload: ${error.message}` }))
  )

  if (event.event_type !== "send.otp" && event.event_type !== "send.magic_link") {
    yield* Effect.logInfo(`Ignoring Managed Auth event ${event.event_type}`)
    return Option.none<OneTimeEmail>()
  }
  const { purpose, secret } =
    event.event_type === "send.otp"
      ? yield* Schema.decodeUnknownEffect(OtpData)(event.event_data).pipe(
          Effect.mapError((error) => new WebhookUnusable({ reason: `unexpected send.otp data: ${error.message}` })),
          Effect.flatMap((data) =>
            data.delivery_preference === "sms"
              ? unusable("SMS codes are not delivered")
              : Effect.succeed({ purpose: data.otp_type, secret: { code: data.otp_code } })
          )
        )
      : yield* Schema.decodeUnknownEffect(MagicLinkData)(event.event_data).pipe(
          Effect.mapError(
            (error) => new WebhookUnusable({ reason: `unexpected send.magic_link data: ${error.message}` })
          ),
          Effect.map((data) => ({ purpose: data.link_type, secret: { url: data.link_url } }))
        )
  const to = event.user?.email
  if (to === undefined || to === "") return yield* unusable(`${event.event_type} has no email address`)

  return Option.some<OneTimeEmail>({
    eventId: event.event_id,
    purpose,
    secret,
    to,
    userId: event.user?.id,
    name: event.user?.name?.trim() || null
  })
})
