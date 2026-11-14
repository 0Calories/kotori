import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk"
import { Config, Context, Duration, Effect, Layer, Schema } from "effect"

export class ClaudeError extends Schema.TaggedError<ClaudeError>()("ClaudeError", {
  reason: Schema.Literals([
    "unconfigured",
    "refused",
    "truncated",
    "invalid_output",
    "rate_limited",
    "unavailable",
    "timed_out"
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}

export type Effort = "low" | "medium" | "high"

export interface GenerateOptions<S extends Schema.Top> {
  /** The shape Claude must answer in; enforced with structured outputs and decoded with Schema. */
  readonly schema: S
  readonly system: string
  readonly prompt: string
  readonly effort?: Effort | undefined
  readonly maxTokens?: number | undefined
  /**
   * How long the whole call may take, the SDK's retries included, before it fails as `timed_out`.
   * Defaults to `ClaudeDeadline.interactive`; offline passes nobody is waiting on pass `bulk`.
   */
  readonly timeout?: Duration.Duration | undefined
}

/** Whole-call deadlines for `generate`: a learner waits on an `interactive` call, nobody on a `bulk` one. */
export const ClaudeDeadline = {
  interactive: Duration.seconds(90),
  bulk: Duration.minutes(5)
} as const

/**
 * How long one attempt may wait for the response to start (the SDK's default is 10 minutes). The
 * SDK arms it around `fetch` only, so a stream that has begun is bounded by the call's deadline
 * instead; a timed-out attempt is retried, within that deadline.
 */
const ATTEMPT_TIMEOUT = Duration.seconds(60)

/** Validation keywords structured outputs doesn't accept; Schema still enforces them when decoding. */
const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems"
])

const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitize)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED.has(key))
      .map(([key, inner]) => [key, sanitize(inner)])
  )
}

/**
 * JSON Schema for structured outputs. Every object is closed (`additionalProperties: false`),
 * as the API requires.
 */
export const outputSchema = (schema: Schema.Top): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })
  const root =
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions }
  return sanitize(root) as Record<string, unknown>
}

const classify = (cause: unknown): ClaudeError => {
  if (cause instanceof Anthropic.RateLimitError) {
    return new ClaudeError({ reason: "rate_limited", message: "Claude is rate limited right now", cause })
  }
  if (cause instanceof Anthropic.AuthenticationError || cause instanceof Anthropic.PermissionDeniedError) {
    return new ClaudeError({ reason: "unconfigured", message: "Claude rejected the configured credentials", cause })
  }
  if (cause instanceof Error && cause.message.includes("Could not resolve authentication method")) {
    return new ClaudeError({ reason: "unconfigured", message: "No Anthropic credentials are configured", cause })
  }
  return new ClaudeError({ reason: "unavailable", message: "Claude request failed", cause })
}

/** How long the availability probe may take; a slower API counts as unavailable until the next probe. */
const PROBE_TIMEOUT = Duration.seconds(2)

export class Claude extends Context.Service<
  Claude,
  {
    readonly model: string
    /**
     * Whether credentials resolve and the model is reachable. Cached for a few minutes, and
     * answers within a couple of seconds even if the API hangs: `/health` (Fly's check) waits on it.
     */
    readonly available: Effect.Effect<boolean>
    generate<S extends Schema.Top>(
      options: GenerateOptions<S>
    ): Effect.Effect<S["Type"], ClaudeError, S["DecodingServices"]>
  }
>()("@kotori/ai/Claude") {
  /** The service over an SDK client built with `options` over Kotori's defaults; tests pass a fake `fetch`. */
  static readonly make = Effect.fnUntraced(function* (options: ClientOptions = {}) {
    const model = yield* Config.String("KOTORI_CLAUDE_MODEL").pipe(Config.withDefault("claude-opus-5-5"))
    // The SDK resolves credentials itself: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant` profile.
    const client = new Anthropic({ maxRetries: 3, timeout: Duration.toMillis(ATTEMPT_TIMEOUT), ...options })

    const available = yield* Effect.cachedWithTTL(
      Effect.tryPromise((signal) =>
        client.models.retrieve(model, null, { signal, timeout: Duration.toMillis(PROBE_TIMEOUT), maxRetries: 0 })
      ).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false))
      ),
      Duration.minutes(5)
    )

    const generate = <S extends Schema.Top>(options: GenerateOptions<S>) =>
      Effect.gen(function* () {
        const deadline = options.timeout ?? ClaudeDeadline.interactive
        const message = yield* Effect.tryPromise({
          try: (signal) =>
            client.beta.messages
              .stream(
                {
                  model,
                  max_tokens: options.maxTokens ?? 16_000,
                  system: options.system,
                  messages: [{ role: "user", content: options.prompt }],
                  output_config: {
                    effort: options.effort ?? "medium",
                    format: { type: "json_schema", schema: outputSchema(options.schema) }
                  },
                  // If a safety classifier declines, retry on Anthropic's recommended fallback model.
                  betas: ["server-side-fallback-2026-07-01"],
                  fallbacks: "default"
                },
                { signal }
              )
              .finalMessage(),
          catch: classify
        }).pipe(
          // The deadline interrupts the request, which aborts it through `signal`, retries and all.
          Effect.timeoutOrElse({
            duration: deadline,
            orElse: () =>
              Effect.fail(
                new ClaudeError({
                  reason: "timed_out",
                  message: `Claude didn't answer within ${Duration.format(deadline)}`
                })
              )
          })
        )

        if (message.stop_reason === "refusal") {
          return yield* new ClaudeError({ reason: "refused", message: "Claude declined to answer this request" })
        }
        if (message.stop_reason === "max_tokens") {
          return yield* new ClaudeError({ reason: "truncated", message: "Claude's answer was cut off" })
        }

        const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
        return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(options.schema))(text).pipe(
          Effect.mapError(
            (cause) =>
              new ClaudeError({ reason: "invalid_output", message: "Claude's answer didn't match the schema", cause })
          )
        )
      }).pipe(Effect.withSpan("Claude.generate", { attributes: { model } }))

    return Claude.of({ model, available, generate })
  })

  static readonly layer = Layer.effect(Claude, Claude.make())
}
