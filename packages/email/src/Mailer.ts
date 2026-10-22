import { Context, Effect, Layer, Ref, Schema } from "effect"

export class MailError extends Schema.TaggedError<MailError>()("MailError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

export interface Email {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

/** Sends transactional email. `MailerLive` picks Resend when `RESEND_API_KEY` is set, otherwise the console. */
export class Mailer extends Context.Service<
  Mailer,
  {
    /** Whether mail actually leaves the machine. */
    readonly configured: boolean
    send(email: Email): Effect.Effect<void, MailError>
  }
>()("@kotori/email/Mailer") {
  /** Logs each message, including links and codes, so flows can be followed in development. */
  static readonly layerConsole = Layer.succeed(
    Mailer,
    Mailer.of({
      configured: false,
      send: (email) =>
        Effect.logInfo(`[mail] to ${email.to}: ${email.subject}\n${email.text}`).pipe(
          Effect.annotateLogs({ to: email.to, subject: email.subject })
        )
    })
  )
}

/** Captures everything the in-memory mailer sends, for tests. */
export class Mailbox extends Context.Service<
  Mailbox,
  {
    readonly messages: Effect.Effect<ReadonlyArray<Email>>
    readonly clear: Effect.Effect<void>
  }
>()("@kotori/email/Mailbox") {}

/** A `Mailer` that stores messages in a `Mailbox` instead of sending them. */
export const MailerMemory: Layer.Layer<Mailer | Mailbox> = Layer.effectContext(
  Effect.gen(function* () {
    const ref = yield* Ref.make<ReadonlyArray<Email>>([])
    const mailbox = Mailbox.of({ messages: Ref.get(ref), clear: Ref.set(ref, []) })
    const mailer = Mailer.of({
      configured: true,
      send: (email) => Ref.update(ref, (sent) => [...sent, email])
    })
    return Context.make(Mailer, mailer).pipe(Context.add(Mailbox, mailbox))
  })
)
