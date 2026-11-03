import * as Sentry from "@sentry/effect/server"
import { Layer, Logger, Tracer } from "effect"

const production = process.env.NODE_ENV === "production"

/**
 * Error reporting, tracing and logs to Sentry (project `sparkwright/kotori-backend`). Failures that
 * reach Effect's HTTP boundary or `ErrorReporter.report` become issues; Effect spans become traces.
 * Without `SENTRY_DSN` (tests, and local development unless you set it) nothing is sent.
 */
export const SentryLive = (service: "api" | "worker") =>
  Layer.mergeAll(
    Sentry.effectLayer({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? (production ? "production" : "development"),
      // The commit, set by the deploy (see the backend's `deploy` target).
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: production ? 0.1 : 1,
      initialScope: { tags: { service } }
    }),
    Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer)
  )

/** Sends Effect logs to Sentry Logs alongside `loggers`, or alongside the default logger when none are given. */
export const loggerLayer = (loggers: ReadonlyArray<Logger.Logger<unknown, unknown>> = []) =>
  Logger.layer([...loggers, Sentry.SentryEffectLogger], { mergeWithExisting: loggers.length === 0 })
