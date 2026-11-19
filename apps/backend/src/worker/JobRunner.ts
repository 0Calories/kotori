import { Cause, Clock, Effect, ErrorReporter, Exit, Option } from "effect"
import { Database } from "../db/Database.ts"
import { Enrichers } from "../features/enrichment/Enrichers.ts"
import type { Job } from "../features/enrichment/index.ts"
import {
  claimJob,
  completeJob,
  failJob,
  releaseJob,
  requeueJob,
  requeueStaleJobs
} from "../features/enrichment/index.ts"

const STALE_AFTER = 10 * 60_000
// Must stay below STALE_AFTER so the stale-job sweep never requeues a job this worker is still running.
const JOB_DEADLINE = 8 * 60_000
const SWEEP_EVERY = 60_000
const RETRY_AFTER = 30_000

export const makeJobRunner = Effect.fn("makeJobRunner")(function* () {
  const db = yield* Database
  const enrichers = yield* Enrichers

  // Keep timeout inside restore so SIGTERM interrupts immediately and releases the job, while a deadline overrun exits with TimeoutError and counts as a failed attempt.
  const runJob = (job: Job, audio: boolean) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { id, kind, entryId, priority, attempts } = job
        const exit = yield* Effect.exit(restore(enrichers.run(kind, entryId).pipe(Effect.timeout(JOB_DEADLINE))))
        const finishedAt = yield* Clock.currentTimeMillis
        const finished = new Date(finishedAt)
        if (Exit.isSuccess(exit)) {
          // Enqueue audio before completing examples so a concurrent poll never sees new examples with audio already settled.
          if (kind === "examples" && audio) yield* requeueJob(db, "audio", entryId, priority, finished)
          yield* completeJob(db, id, finished)
          yield* Effect.logInfo(`${kind} ${entryId}: ${exit.value}`)
        } else if (Cause.hasInterrupts(exit.cause)) {
          yield* releaseJob(db, id, finished)
          yield* Effect.logInfo(`${kind} ${entryId}: interrupted, back in the queue`)
        } else {
          yield* failJob(
            db,
            id,
            String(Cause.squash(exit.cause)),
            new Date(finishedAt + RETRY_AFTER * 2 ** attempts),
            finished
          )
          yield* ErrorReporter.report(exit.cause)
          yield* Effect.logWarning(`${kind} ${entryId} failed (attempt ${attempts})`, exit.cause)
        }
      })
    )

  let nextSweep = 0
  let announced: string | undefined
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (now >= nextSweep) {
      yield* requeueStaleJobs(db, new Date(now - STALE_AFTER), new Date(now))
      nextSweep = now + SWEEP_EVERY
    }
    // Re-check providers each cycle so a transient Claude probe failure during boot does not leave jobs stuck.
    const kinds = yield* enrichers.available
    const listed = kinds.join(", ")
    if (listed !== announced) {
      announced = listed
      yield* Effect.logInfo(
        kinds.length === 0
          ? "No enrichment providers are available; waiting anyway. See .env.example."
          : `Worker ready for: ${listed}`
      )
    }
    const job = yield* claimJob(db, kinds, new Date(now))
    if (Option.isNone(job)) return false
    yield* runJob(job.value, kinds.includes("audio"))
    return true
  })
})
