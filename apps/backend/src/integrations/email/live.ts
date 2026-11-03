import { Config, Effect, Layer, Option } from "effect"
import { Mailer } from "./Mailer.ts"
import { Resend } from "./Resend.ts"

/** Resend when `RESEND_API_KEY` is set, otherwise the console (links and codes end up in the API log). */
export const MailerLive = Layer.unwrap(
  Effect.gen(function* () {
    const apiKey = yield* Config.option(Config.Redacted("RESEND_API_KEY"))
    return Option.isSome(apiKey) ? Resend.layer : Mailer.layerConsole
  })
)
