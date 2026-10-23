import { UsersRepo } from "@kotori/db"
import { type MailError, Mailer, type OneTime, templates } from "@kotori/email"
import { Clock, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import type { Headers } from "effect/http"
import { emailLanguage } from "./Approvals.ts"
import { Auth, type AuthUpstreamError } from "./Auth.ts"
import { signatureIsValid } from "./WebhookSignature.ts"

/** Neon's replay window: a correctly signed request older than this is still turned away. */
const MAX_AGE = Duration.minutes(5)

/** How long a delivered event id is remembered, comfortably past Neon's 15 s of retries. */
const REMEMBER = Duration.minutes(15)

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

const TEMPLATES = {
  "email-verification": templates.verifyEmail,
  "forget-password": templates.resetPassword,
  "sign-in": templates.signIn
}

export type WebhookOutcome = "sent" | "duplicate" | "ignored"

/**
 * Managed Better Auth's `send.otp` and `send.magic_link` webhooks, which replace its
 * own emails, so verification, reset and sign-in codes go out through Resend with
 * Kotori's templates, in the learner's language. Fails closed: nothing is sent, and
 * the request is refused, unless the signature verifies against Managed Auth's keys.
 */
export class AuthWebhooks extends Context.Service<
  AuthWebhooks,
  {
    /** Verifies a webhook and delivers what it carries; other event types are acknowledged and ignored. */
    receive(
      headers: Headers.Headers,
      body: Uint8Array
    ): Effect.Effect<WebhookOutcome, WebhookRejected | WebhookUnusable | AuthUpstreamError | MailError>
  }
>()("@kotori/auth/AuthWebhooks") {
  static readonly layer = Layer.effect(
    AuthWebhooks,
    Effect.gen(function* () {
      const auth = yield* Auth
      const users = yield* UsersRepo
      const mailer = yield* Mailer

      // Neon retries with the same event id when a response is lost; this process doesn't send twice.
      const delivered = new Map<string, number>()
      const remember = (eventId: string, now: number) => {
        for (const [id, at] of delivered) if (now - at > Duration.toMillis(REMEMBER)) delivered.delete(id)
        delivered.set(eventId, now)
      }

      const reject = (reason: string) => Effect.fail(new WebhookRejected({ reason }))
      const unusable = (reason: string) => Effect.fail(new WebhookUnusable({ reason }))

      const verify = Effect.fn("AuthWebhooks.verify")(function* (headers: Headers.Headers, body: Uint8Array) {
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
        return yield* decodeEnvelope(text).pipe(
          Effect.mapError((error) => new WebhookUnusable({ reason: `unexpected payload: ${error.message}` }))
        )
      })

      const oneTimeFor = Effect.fn("AuthWebhooks.oneTime")(function* (event: typeof Envelope.Type) {
        if (event.event_type === "send.otp") {
          const data = yield* Schema.decodeUnknownEffect(OtpData)(event.event_data).pipe(
            Effect.mapError((error) => new WebhookUnusable({ reason: `unexpected send.otp data: ${error.message}` }))
          )
          if (data.delivery_preference === "sms") return yield* unusable("SMS codes are not delivered")
          return { purpose: data.otp_type, secret: { code: data.otp_code } satisfies OneTime }
        }
        const data = yield* Schema.decodeUnknownEffect(MagicLinkData)(event.event_data).pipe(
          Effect.mapError(
            (error) => new WebhookUnusable({ reason: `unexpected send.magic_link data: ${error.message}` })
          )
        )
        return { purpose: data.link_type, secret: { url: data.link_url } satisfies OneTime }
      })

      const receive = Effect.fn("AuthWebhooks.receive")(
        function* (headers: Headers.Headers, body: Uint8Array) {
          const event = yield* verify(headers, body)
          if (event.event_type !== "send.otp" && event.event_type !== "send.magic_link") {
            yield* Effect.logInfo(`Ignoring Managed Auth event ${event.event_type}`)
            return "ignored" as const
          }
          if (delivered.has(event.event_id)) return "duplicate" as const

          const { purpose, secret } = yield* oneTimeFor(event)
          const to = event.user?.email
          if (to === undefined || to === "") return yield* unusable(`${event.event_type} has no email address`)
          // Same rule as the approval email: the learner's chosen language once they've onboarded.
          const profile = event.user?.id === undefined ? Option.none() : yield* users.byId(event.user.id)
          const language = emailLanguage(Option.getOrUndefined(profile))
          const name = event.user?.name?.trim() || null

          yield* mailer.send(TEMPLATES[purpose]({ to, name, language }, secret))
          remember(event.event_id, yield* Clock.currentTimeMillis)
          yield* Effect.logInfo(`Sent the ${purpose} email`).pipe(Effect.annotateLogs({ language }))
          return "sent" as const
        },
        (effect, headers) =>
          effect.pipe(
            Effect.annotateLogs({
              webhookEvent: headers["x-neon-event-id"] ?? "",
              attempt: headers["x-neon-delivery-attempt"] ?? ""
            }),
            Effect.tapError((error) => Effect.logWarning("Managed Auth webhook not delivered", error))
          )
      )

      return AuthWebhooks.of({ receive })
    })
  )
}
