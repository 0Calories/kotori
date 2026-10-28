import { Enrichment } from "@kotori/services"
import { Cause, Console, Duration, Effect, Schedule } from "effect"
import { Command, Flag } from "effect/cli"
import { makeJobRunner } from "../JobRunner.ts"

/** Waits between tries when a cycle fails (usually the database being unreachable): 1 s doubling, at most 1 min. */
const BACKOFF = Schedule.min([Schedule.exponential(Duration.seconds(1)), Schedule.spaced(Duration.minutes(1))])

export const work = Command.make(
  "work",
  {
    idle: Flag.Int("idle-ms").pipe(
      Flag.withDescription("Polling interval when the queue is empty"),
      Flag.withDefault(2000)
    )
  },
  Effect.fn(function* ({ idle }) {
    const kinds = yield* Enrichment.available
    yield* Console.log(
      kinds.length === 0
        ? "No enrichment providers are configured; waiting anyway. See .env.example."
        : `Worker ready for: ${kinds.join(", ")}`
    )
    const step = makeJobRunner(kinds)

    // A failed cycle (database errors are defects) backs off and tries again instead of ending
    // the process: a brief database outage shouldn't use up the machine's restart budget.
    yield* step.pipe(
      Effect.flatMap((worked) => (worked ? Effect.void : Effect.sleep(Duration.millis(idle)))),
      Effect.sandbox,
      Effect.tapError((cause) =>
        Cause.hasInterrupts(cause) ? Effect.void : Effect.logError("Work cycle failed; backing off", cause)
      ),
      Effect.retry({ schedule: BACKOFF, while: (cause) => !Cause.hasInterrupts(cause) }),
      Effect.catch(Effect.failCause),
      Effect.forever
    )
  })
).pipe(Command.withDescription("Process enrichment requested on demand by the API"))
