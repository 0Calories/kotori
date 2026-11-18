import * as Sentry from "@sentry/effect/server"
import { Context, Effect, Layer, Logger, Tracer } from "effect"

const production = process.env.NODE_ENV === "production"

const CurrentScope = Context.Reference<Sentry.Scope | undefined>("@kotori/backend/Sentry/CurrentScope", {
  defaultValue: () => undefined
})

const evaluate = "~effect/Effect/evaluate"

// @sentry/effect stores isolation scopes in AsyncLocalStorage, which does not follow interleaved Effect fibers, so rebind CurrentScope on each fiber step.
const ScopedSentryTracer = Tracer.make({
  span: (options) => Sentry.SentryEffectTracer.span(options),
  context: (primitive, fiber) => {
    const run = () =>
      Sentry.SentryEffectTracer.context === undefined
        ? primitive[evaluate](fiber)
        : Sentry.SentryEffectTracer.context(primitive, fiber)
    const scope = fiber.getRef(CurrentScope)
    return scope === undefined ? run() : Sentry.withIsolationScope(scope, run)
  }
})

// Clone into CurrentScope rather than calling Sentry.setUser directly, which mutates a process-wide scope across concurrent fibers.
export const withScope =
  (configure: (scope: Sentry.Scope) => void) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const scope = Sentry.getIsolationScope().clone()
      configure(scope)
      return Effect.provideService(effect, CurrentScope, scope)
    })

export const SentryLive = (service: "api" | "worker" | "cli", overrides: Sentry.EffectServerLayerOptions = {}) =>
  Layer.mergeAll(
    Sentry.effectLayer({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? (production ? "production" : "development"),
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: production ? 0.1 : 1,
      initialScope: { tags: { service } },
      ...overrides
    }),
    Layer.succeed(Tracer.Tracer, ScopedSentryTracer)
  )

export const loggerLayer = (loggers: ReadonlyArray<Logger.Logger<unknown, unknown>> = []) =>
  Logger.layer([...loggers, Sentry.SentryEffectLogger], { mergeWithExisting: loggers.length === 0 })
