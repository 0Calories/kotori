import { verifyWebhook } from "@kotori/auth"
import { Mailer, templates } from "@kotori/email"
import { Clock, Context, Duration, Effect, Layer, Option } from "effect"
import type { Headers } from "effect/http"
import { emailLanguage, profileRow } from "./profiles.ts"

/** How long a delivered event id is remembered, comfortably past Neon's 15 s of retries. */
const REMEMBER = Duration.minutes(15)

const TEMPLATES = {
  "email-verification": templates.verifyEmail,
  "forget-password": templates.resetPassword,
  "sign-in": templates.signIn
}

/** Managed Auth events this process has emailed, so a retried event isn't sent twice. */
export class AuthEmailDeliveries extends Context.Service<
  AuthEmailDeliveries,
  { has(eventId: string): boolean; remember(eventId: string, now: number): void }
>()("@kotori/services/AuthEmailDeliveries") {
  static readonly layer = Layer.sync(AuthEmailDeliveries, () => {
    const delivered = new Map<string, number>()
    return AuthEmailDeliveries.of({
      has: (eventId) => delivered.has(eventId),
      remember: (eventId, now) => {
        for (const [id, at] of delivered) if (now - at > Duration.toMillis(REMEMBER)) delivered.delete(id)
        delivered.set(eventId, now)
      }
    })
  })
}

export type AuthEmailOutcome = "sent" | "duplicate" | "ignored"

/**
 * Delivers the verification, reset and sign-in codes Managed Better Auth's webhooks carry,
 * through Kotori's own templates and in the learner's language. Nothing is sent unless the
 * webhook verifies; other event types are acknowledged and ignored.
 */
export const deliverAuthEmail = Effect.fn("accounts.deliverAuthEmail")(
  function* (headers: Headers.Headers, body: Uint8Array) {
    const event = yield* verifyWebhook(headers, body)
    if (Option.isNone(event)) return "ignored" satisfies AuthEmailOutcome
    const { eventId, purpose, secret, to, userId, name } = event.value
    // Neon retries with the same event id when a response is lost; this process doesn't send twice.
    const deliveries = yield* AuthEmailDeliveries
    if (deliveries.has(eventId)) return "duplicate" satisfies AuthEmailOutcome

    // Same rule as the approval email: the learner's chosen language once they've onboarded.
    const profile = userId === undefined ? Option.none() : yield* profileRow(userId)
    const language = emailLanguage(Option.getOrUndefined(profile))
    yield* (yield* Mailer).send(TEMPLATES[purpose]({ to, name, language }, secret))
    deliveries.remember(eventId, yield* Clock.currentTimeMillis)
    yield* Effect.logInfo(`Sent the ${purpose} email`).pipe(Effect.annotateLogs({ language }))
    return "sent" satisfies AuthEmailOutcome
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
