import { Cause, Duration, Effect, ErrorReporter, Schedule } from "effect"
import { makeJobRunner } from "./JobRunner.ts"

const BACKOFF = Schedule.min([Schedule.exponential(Duration.seconds(1)), Schedule.spaced(Duration.minutes(1))])

export const work = Effect.fn("work")(function* (idle: Duration.Input) {
  const step = yield* makeJobRunner()

  // Sandbox and retry defects so a brief database outage backs off instead of exhausting the host's process restart budget.
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
