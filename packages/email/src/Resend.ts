import { Config, Effect, Layer, Redacted, Schedule } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { MailError, Mailer } from "./Mailer.ts"

/**
 * Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * One endpoint, so no SDK. The default sender only delivers to the Resend
 * account's own address; set KOTORI_EMAIL_FROM to a verified domain for testers.
 */
export const Resend = {
  layer: Layer.effect(
    Mailer,
    Effect.gen(function*() {
      const apiKey = yield* Config.Redacted("RESEND_API_KEY")
      const from = yield* Config.String("KOTORI_EMAIL_FROM").pipe(Config.withDefault("Kotori <onboarding@resend.dev>"))
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.resend.com")),
        HttpClient.retryTransient({ schedule: Schedule.exponential(500), times: 3 })
      )

      const send = Effect.fn("Resend.send")(function*(email: { to: string; subject: string; text: string; html: string }) {
        const response = yield* HttpClientRequest.post("/emails").pipe(
          HttpClientRequest.bearerToken(Redacted.value(apiKey)),
          HttpClientRequest.bodyJsonUnsafe({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
          client.execute,
          Effect.mapError((cause) => new MailError({ message: "Could not reach Resend", cause }))
        )
        if (response.status >= 400) {
          const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
          return yield* new MailError({ message: `Resend returned ${response.status}: ${detail.slice(0, 300)}` })
        }
      })

      return Mailer.of({ configured: true, send })
    })
  )
}
