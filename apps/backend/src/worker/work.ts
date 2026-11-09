import { Cause, Duration, Effect, ErrorReporter, Schedule } from "effect"
import { makeJobRunner } from "./JobRunner.ts"

/** Waits between tries when a cycle fails (usually the database being unreachable): 1 s doubling, at most 1 min. */
const BACKOFF = Schedule.min([Schedule.exponential(Duration.seconds(1)), Schedule.spaced(Duration.minutes(1))])

/**
 * Processes enrichment requested on demand by the API, forever: claims the most urgent job,
 * runs it, and polls every `idle` while the queue is empty.
 */
export const work = Effect.fn("work")(function* (idle: Duration.Input) {
  const step = yield* makeJobRunner()

  // A failed cycle (query errors are defects) backs off and tries again instead of ending
  // the process: a brief database outage shouldn't use up the machine's restart budget.
  return yield* step.pipe(
    Effect.flatMap((worked) => (worked ? Effect.void : Effect.sleep(idle))),
    Effect.sandbox,
    Effect.tapError((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.void
        : Effect.andThen(ErrorReporter.report(cause), Effect.logError("Work cycle failed; backing off", cause))
    ),
    Effect.retry({ schedule: BACKOFF, while: (cause) => !Cause.hasInterrupts(cause) }),
    Effect.catch(Effect.failCause),
    Effect.forever
  )
})
