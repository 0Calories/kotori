import { UserId } from "@kotori/db"
import { Clock, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import type { Headers } from "effect/http"
import { Database } from "../../db/Database.ts"
import { Auth, type AuthUpstreamError } from "../../integrations/auth/Auth.ts"
import { signatureIsValid } from "../../integrations/auth/WebhookSignature.ts"
import { type MailError, Mailer } from "../../integrations/email/Mailer.ts"
import { type OneTime, templates } from "../../integrations/email/templates.ts"
import { emailLanguage } from "./Approvals.ts"
import { userById } from "./queries.ts"

const MAX_AGE = Duration.minutes(5)

const REMEMBER = Duration.minutes(15)

export class WebhookRejected extends Schema.TaggedError<WebhookRejected>()("WebhookRejected", {
  reason: Schema.String
}) {}

export class WebhookUnusable extends Schema.TaggedError<WebhookUnusable>()("WebhookUnusable", {
  reason: Schema.String
}) {}

const Purpose = Schema.Literals(["email-verification", "forget-password", "sign-in"])

const Envelope = Schema.Struct({
  event_id: Schema.String,
  event_type: Schema.String,
  user: Schema.optional(
    Schema.Struct({
      id: Schema.optional(UserId),
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

export class AuthWebhooks extends Context.Service<
  AuthWebhooks,
  {
    receive(
      headers: Headers.Headers,
      body: Uint8Array
    ): Effect.Effect<WebhookOutcome, WebhookRejected | WebhookUnusable | AuthUpstreamError | MailError>
  }
>()("@kotori/backend/AuthWebhooks") {
  static readonly layer = Layer.effect(
    AuthWebhooks,
    Effect.gen(function* () {
      const auth = yield* Auth
      const db = yield* Database
      const mailer = yield* Mailer

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
          const profile = event.user?.id === undefined ? Option.none() : yield* userById(db, event.user.id)
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
