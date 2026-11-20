import type * as Sentry from "@sentry/effect/server"
import { Context, Effect, Layer, Logger, Tracer } from "effect"

type SentrySdk = typeof Sentry

const production = process.env.NODE_ENV === "production"

// `@sentry/effect/server` pulls in `@sentry/node` and OpenTelemetry (~300ms on cold start),
// so load it on demand only when Sentry is actually enabled (`SENTRY_DSN` or test overrides).
let sdk: SentrySdk | undefined
const loadSdk = (): Promise<SentrySdk> =>
  sdk !== undefined
    ? Promise.resolve(sdk)
    : import("@sentry/effect/server").then((loaded) => {
        sdk = loaded
        return loaded
      })

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
const makeScopedSentryTracer = (sentry: SentrySdk) =>
  Tracer.make({
    span: (options) => sentry.SentryEffectTracer.span(options),
    context: (primitive, fiber) => {
      const run = () =>
        sentry.SentryEffectTracer.context === undefined
          ? primitive[evaluate](fiber)
          : sentry.SentryEffectTracer.context(primitive, fiber)
      const scope = fiber.getRef(CurrentScope)
      return scope === undefined ? run() : sentry.withIsolationScope(scope, run)
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
      if (sdk === undefined) return effect
      const scope = sdk.getIsolationScope().clone()
      configure(scope)
      return Effect.provideService(effect, CurrentScope, scope)
    })

/**
 * Error reporting, tracing and logs to Sentry (project `sparkwright/kotori-backend`). Failures that
 * reach Effect's HTTP boundary or `ErrorReporter.report` become issues; Effect spans become traces.
 * Without `SENTRY_DSN` (tests, and local development unless you set it) nothing is loaded or sent.
 * `overrides` is for tests, to capture what would be sent.
 */
export const SentryLive = (service: "api" | "worker" | "cli", overrides: Sentry.EffectServerLayerOptions = {}) =>
  Layer.unwrap(
    Effect.suspend(() => {
      const dsn = overrides.dsn ?? process.env.SENTRY_DSN
      if (!dsn) return Effect.succeed(Layer.empty)
      return Effect.promise(() =>
        loadSdk().then((sentry) =>
          Layer.mergeAll(
            sentry.effectLayer({
              dsn,
              environment: process.env.SENTRY_ENVIRONMENT ?? (production ? "production" : "development"),
              // The commit, set by the deploy (see the backend's `deploy` target).
              release: process.env.SENTRY_RELEASE,
              tracesSampleRate: production ? 0.1 : 1,
              initialScope: { tags: { service } },
              ...overrides
            }),
            Layer.succeed(Tracer.Tracer, makeScopedSentryTracer(sentry))
          )
        )
      )
    })
  )

/** Sends Effect logs to Sentry Logs alongside `loggers`, or alongside the default logger when none are given. */
export const loggerLayer = (loggers: ReadonlyArray<Logger.Logger<unknown, unknown>> = []) =>
  Layer.unwrap(
    Effect.suspend(() => {
      if (!process.env.SENTRY_DSN) {
        return Effect.succeed(loggers.length === 0 ? Layer.empty : Logger.layer(loggers, { mergeWithExisting: false }))
      }
      return Effect.promise(() =>
        loadSdk().then((sentry) =>
          Logger.layer([...loggers, sentry.SentryEffectLogger], { mergeWithExisting: loggers.length === 0 })
        )
      )
    })
  )
