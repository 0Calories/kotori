import { type EntryType, type Questions, type SystemOneResult, TypeSafeClient } from "@typesafe-ai/sdk"
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export class JevError extends Schema.TaggedError<JevError>()("JevError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/** TypeSafe's Jev: typed judgments (choice, score, yes/no) with calibrated probabilities. */
export class Jev extends Context.Service<
  Jev,
  {
    readonly configured: boolean
    /** The pinned model id; answers record the exact version that ran. */
    readonly model: string
    ask<Q extends Questions>(state: EntryType, questions: Q): Effect.Effect<SystemOneResult<Q>, JevError>
  }
>()("@kotori/nuance/Jev") {
  static readonly layer = Layer.effect(
    Jev,
    Effect.gen(function* () {
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
        timeout: 30_000,
        retry: { maxRetries: 4 }
      })

      const ask = <Q extends Questions>(state: EntryType, questions: Q) =>
        Effect.tryPromise({
          try: (signal) => client.systemOne({ state, questions, model }, { signal }),
          catch: (cause) => new JevError({ message: "Jev request failed", cause })
        }).pipe(Effect.withSpan("Jev.ask", { attributes: { questions: Object.keys(questions).length } }))

      return Jev.of({ configured: true, model, ask })
    })
  )
}
