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

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly configured: boolean
    send(email: Email): Effect.Effect<void, MailError>
  }
>()("@kotori/backend/Mailer") {
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

export class Mailbox extends Context.Service<
  Mailbox,
  {
    readonly messages: Effect.Effect<ReadonlyArray<Email>>
    readonly clear: Effect.Effect<void>
  }
>()("@kotori/backend/Mailbox") {}

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
