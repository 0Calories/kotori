import type { Language } from "@kotori/contracts"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

export class TtsError extends Schema.TaggedError<TtsError>()("TtsError", {
  reason: Schema.Literals(["unconfigured", "quota", "failed", "timed_out"]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

/**
 * How long one request may wait for ElevenLabs to respond; a timed-out attempt is retried like
 * any other transient failure. `HttpClient` has no timeout of its own.
 */
const ATTEMPT_TIMEOUT = Duration.seconds(30)
/** How long a whole `synthesize` may take, retries and reading the audio included. */
const SYNTHESIZE_DEADLINE = Duration.seconds(90)

export class ElevenLabs extends Context.Service<
  ElevenLabs,
  {
    readonly configured: boolean
    readonly model: string
    /** Speaks `text` with the given ElevenLabs voice and returns MP3 bytes. */
    synthesize(text: string, language: Language, voiceId: string): Effect.Effect<Uint8Array, TtsError>
  }
>()("@kotori/ai/ElevenLabs") {
  static readonly layer = Layer.effect(
    ElevenLabs,
    Effect.gen(function* () {
      const apiKey = yield* Config.Redacted("ELEVENLABS_API_KEY").pipe(Config.option)
      const model = yield* Config.String("KOTORI_ELEVENLABS_MODEL").pipe(Config.withDefault("eleven_v4"))
      if (Option.isNone(apiKey)) {
        return ElevenLabs.of({
          configured: false,
          model,
          synthesize: () =>
            Effect.fail(new TtsError({ reason: "unconfigured", message: "ELEVENLABS_API_KEY is not set" }))
        })
      }

      // Either timeout interrupts the request, which aborts it.
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.elevenlabs.io")),
        HttpClient.transformResponse(Effect.timeout(ATTEMPT_TIMEOUT)),
        HttpClient.retryTransient({ schedule: Schedule.exponential(500), times: 3 })
      )

      const synthesize = Effect.fn("ElevenLabs.synthesize")(
        function* (text: string, language: Language, voiceId: string) {
          const response = yield* HttpClientRequest.post(`/v1/text-to-speech/${voiceId}`).pipe(
            HttpClientRequest.setUrlParams({ output_format: "mp3_44100_128" }),
            HttpClientRequest.setHeader("xi-api-key", Redacted.value(apiKey.value)),
            HttpClientRequest.bodyJsonUnsafe({ text, model_id: model, language_code: language }),
            client.execute,
            Effect.mapError((cause) => new TtsError({ reason: "failed", message: "Could not reach ElevenLabs", cause }))
          )
          if (response.status >= 400) {
            const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
            const reason =
              response.status === 401 && detail.includes("quota")
                ? "quota"
                : response.status === 401
                  ? "unconfigured"
                  : "failed"
            return yield* new TtsError({
              reason,
              message: `ElevenLabs returned ${response.status}: ${detail.slice(0, 300)}`
            })
          }
          const body = yield* response.arrayBuffer.pipe(
            Effect.mapError((cause) => new TtsError({ reason: "failed", message: "Could not read audio", cause }))
          )
          return new Uint8Array(body)
        },
        Effect.timeoutOrElse({
          duration: SYNTHESIZE_DEADLINE,
          orElse: () =>
            Effect.fail(
              new TtsError({
                reason: "timed_out",
                message: `ElevenLabs didn't answer within ${Duration.format(SYNTHESIZE_DEADLINE)}`
              })
            )
        })
      )

      return ElevenLabs.of({ configured: true, model, synthesize })
    })
  )
}
