import { Enrichment } from "@kotori/services"
import { Clock, Effect } from "effect"

/** How often to look for jobs left `running` by a worker that died: at startup and then while working. */
const SWEEP_EVERY = 60_000

/**
 * One cycle of the enrichment queue for the given kinds: puts stale jobs back when a sweep
 * is due, then claims, runs and settles the most urgent runnable job. Succeeds with whether
 * there was a job, so the caller knows when to wait. `kotori work` runs it forever.
 */
export const makeJobRunner = (kinds: ReadonlyArray<Enrichment.JobKind>) => {
  let nextSweep = 0
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (now >= nextSweep) {
      yield* Enrichment.requeueStale
      nextSweep = now + SWEEP_EVERY
    }
    return yield* Enrichment.claimAndRun(kinds)
  })
}
