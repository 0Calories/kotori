import {
  type EntryType,
  type Questions,
  type SystemOneResult,
  TypeSafeClient,
  type TypeSafeClientConfig
} from "@typesafe-ai/sdk"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"

export class JevError extends Schema.TaggedError<JevError>()("JevError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/** `TypeSafeClient` has no total-call timeout and honours `Retry-After` up to 60s, so callers bound the whole call here. */
export const JevDeadline = {
  interactive: Duration.seconds(20),
  bulk: Duration.minutes(2)
} as const

export interface AskOptions {
  readonly timeout?: Duration.Duration | undefined
}

export class Jev extends Context.Service<
  Jev,
  {
    readonly configured: boolean
    readonly model: string
    ask<Q extends Questions>(
      state: EntryType,
      questions: Q,
      options?: AskOptions
    ): Effect.Effect<SystemOneResult<Q>, JevError>
  }
>()("@kotori/ai/Jev") {
  static readonly make = Effect.fnUntraced(function* (config: Omit<TypeSafeClientConfig, "apiKey"> = {}) {
    // Pinned so stored confidences stay comparable; bump deliberately and re-run enrichment.
    const model = yield* Config.String("KOTORI_JEV_MODEL").pipe(Config.withDefault("jev-1.14.0"))
    const apiKey = yield* Config.Redacted("TYPESAFE_API_KEY").pipe(Config.option)

    if (Option.isNone(apiKey)) {
      return Jev.of({
        configured: false,
        model,
        ask: () => Effect.fail(new JevError({ message: "TYPESAFE_API_KEY is not set" }))
      })
    }

    const client = new TypeSafeClient({
      apiKey: Redacted.value(apiKey.value),
      defaultModel: model,
      // Per attempt; an interactive deadline is shorter, so a hung attempt there isn't retried.
      timeout: 30_000,
      retry: { maxRetries: 4 },
      ...config
    })

    const ask = <Q extends Questions>(state: EntryType, questions: Q, options?: AskOptions) => {
      const deadline = options?.timeout ?? JevDeadline.interactive
      return Effect.tryPromise({
        try: (signal) => client.systemOne({ state, questions, model }, { signal }),
        catch: (cause) => new JevError({ message: "Jev request failed", cause })
      }).pipe(
        Effect.timeoutOrElse({
          duration: deadline,
          orElse: () => Effect.fail(new JevError({ message: `Jev didn't answer within ${Duration.format(deadline)}` }))
        }),
        Effect.withSpan("Jev.ask", { attributes: { questions: Object.keys(questions).length } })
      )
    }

    return Jev.of({ configured: true, model, ask })
  })

  static readonly layer = Layer.effect(Jev, Jev.make())
}
