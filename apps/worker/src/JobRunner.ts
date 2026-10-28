import { type Job, type JobKind, JobsRepo } from "@kotori/db"
import { Cause, Clock, Effect, Exit, Option } from "effect"
import { Enrichers } from "./Enrichers.ts"

/** A job still `running` this long after its claim belongs to a worker that crashed or was killed. */
const STALE_AFTER = 10 * 60_000
/** How often to look for such jobs: at startup and then while working. */
const SWEEP_EVERY = 60_000
/** First wait before retrying a failed job; it doubles with each attempt. */
const RETRY_AFTER = 30_000

/**
 * One cycle of the enrichment queue for the given kinds: puts stale jobs back when a sweep
 * is due, claims the most urgent runnable job, runs it and settles it. Succeeds with whether
 * there was a job, so the caller knows when to wait. `kotori work` runs it forever.
 */
export const makeJobRunner = Effect.fn("makeJobRunner")(function* (kinds: ReadonlyArray<JobKind>) {
  const jobs = yield* JobsRepo
  const enrichers = yield* Enrichers

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
          if (kind === "examples" && kinds.includes("audio")) yield* jobs.requeue("audio", entryId, priority, finished)
        } else if (Cause.hasInterrupts(exit.cause)) {
          yield* jobs.release(id, finished)
          yield* Effect.logInfo(`${kind} ${entryId}: interrupted, back in the queue`)
        } else {
          yield* jobs.fail(id, String(Cause.squash(exit.cause)), finished + RETRY_AFTER * 2 ** attempts, finished)
          yield* Effect.logWarning(`${kind} ${entryId} failed (attempt ${attempts})`, exit.cause)
        }
      })
    )

  let nextSweep = 0
  return Effect.gen(function* () {
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
})
