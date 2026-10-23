import { type Job, JobsRepo } from "@kotori/db"
import { Cause, Clock, Console, Duration, Effect, Exit, Option, Schedule } from "effect"
import { Command, Flag } from "effect/cli"
import { Enrichers } from "../Enrichers.ts"

/** A job still `running` this long after its claim belongs to a worker that crashed or was killed. */
const STALE_AFTER = 10 * 60_000
/** How often to look for such jobs: at startup and then while working. */
const SWEEP_EVERY = 60_000
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
    const jobs = yield* JobsRepo
    const enrichers = yield* Enrichers
    const kinds = yield* enrichers.available
    yield* Console.log(
      kinds.length === 0
        ? "No enrichment providers are configured; waiting anyway. See .env.example."
        : `Worker ready for: ${kinds.join(", ")}`
    )

    // Only the enrichment itself is interruptible, so every claimed job is settled: on shutdown
    // (SIGTERM during a deploy) an interrupted job goes back in the queue instead of staying `running`.
    const runJob = (job: Job) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const { id, kind, entryId, priority, attempts } = job
          const exit = yield* Effect.exit(restore(enrichers.run(kind, entryId)))
          const finished = yield* Clock.currentTimeMillis
          if (Exit.isSuccess(exit)) {
            yield* jobs.complete(id, finished)
            yield* Effect.logInfo(`${kind} ${entryId}: ${exit.value}`)
            // New example sentences need voicing too.
            if (kind === "examples" && kinds.includes("audio"))
              yield* jobs.requeue("audio", entryId, priority, finished)
          } else if (Cause.hasInterrupts(exit.cause)) {
            yield* jobs.release(id, finished)
            yield* Effect.logInfo(`${kind} ${entryId}: interrupted, back in the queue`)
          } else {
            const retryAt = finished + 30_000 * 2 ** attempts
            yield* jobs.fail(id, String(Cause.squash(exit.cause)), retryAt, finished)
            yield* Effect.logWarning(`${kind} ${entryId} failed (attempt ${attempts})`, exit.cause)
          }
        })
      )

    let nextSweep = 0
    const step = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (now >= nextSweep) {
        yield* jobs.requeueStale(now - STALE_AFTER, now)
        nextSweep = now + SWEEP_EVERY
      }
      const job = yield* jobs.claim(kinds, now)
      if (Option.isNone(job)) return false
      yield* runJob(job.value)
      return true
    })

    // A failed cycle (repository errors are defects) backs off and tries again instead of ending
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
