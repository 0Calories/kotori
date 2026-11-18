import * as Sentry from "@sentry/effect/server"
import { Context, Effect, Layer, Logger, Tracer } from "effect"

const production = process.env.NODE_ENV === "production"

/**
 * The Sentry isolation scope of the work a fiber belongs to — one request, job or evaluation — or
 * `undefined` outside any. Forked fibers inherit it with the rest of their context.
 */
const CurrentScope = Context.Reference<Sentry.Scope | undefined>("@kotori/backend/Sentry/CurrentScope", {
  defaultValue: () => undefined
})

const evaluate = "~effect/Effect/evaluate"

/**
 * `SentryEffectTracer`, plus: every step of a fiber that carries a `CurrentScope` runs with that scope
 * as Sentry's isolation scope. Sentry's own state lives in AsyncLocalStorage, which doesn't follow a
 * fiber (fibers interleave on one thread, and `@sentry/effect` forks no isolation scope), so this is
 * what makes `withScope` per fiber. The tracer's `context` hook runs synchronously around each step,
 * and errors (`ErrorReporter`), logs and spans are all captured synchronously within one.
 */
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

/**
 * Runs `effect` with its own Sentry isolation scope, a copy of the enclosing one changed by
 * `configure` — say `scope.setUser(...)`. Errors, logs and spans from `effect` and the fibers it forks
 * carry it; nothing outside does. Use this, never `Sentry.setUser` and friends: those write to a
 * scope the whole process shares.
 */
export const withScope =
  (configure: (scope: Sentry.Scope) => void) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const scope = Sentry.getIsolationScope().clone()
      configure(scope)
      return Effect.provideService(effect, CurrentScope, scope)
    })

/**
 * Error reporting, tracing and logs to Sentry (project `sparkwright/kotori-backend`). Failures that
 * reach Effect's HTTP boundary or `ErrorReporter.report` become issues; Effect spans become traces.
 * Without `SENTRY_DSN` (tests, and local development unless you set it) nothing is sent. `overrides`
 * is for tests, to capture what would be sent.
 */
export const SentryLive = (service: "api" | "worker" | "cli", overrides: Sentry.EffectServerLayerOptions = {}) =>
  Layer.mergeAll(
    Sentry.effectLayer({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? (production ? "production" : "development"),
      // The commit, set by the deploy (see the backend's `deploy` target).
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: production ? 0.1 : 1,
      initialScope: { tags: { service } },
      ...overrides
    }),
    Layer.succeed(Tracer.Tracer, ScopedSentryTracer)
  )

/** Sends Effect logs to Sentry Logs alongside `loggers`, or alongside the default logger when none are given. */
export const loggerLayer = (loggers: ReadonlyArray<Logger.Logger<unknown, unknown>> = []) =>
  Logger.layer([...loggers, Sentry.SentryEffectLogger], { mergeWithExisting: loggers.length === 0 })
