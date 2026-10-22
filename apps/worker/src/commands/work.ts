import { JobsRepo } from "@kotori/db"
import { Clock, Console, Duration, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Enrichers } from "../Enrichers.ts"

const STALE_AFTER = 10 * 60_000

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

    const now = yield* Clock.currentTimeMillis
    yield* jobs.requeueStale(now - STALE_AFTER, now)

    const step = Effect.gen(function* () {
      const job = yield* jobs.claim(kinds, yield* Clock.currentTimeMillis)
      if (Option.isNone(job)) return false
      const { id, kind, entryId, priority, attempts } = job.value
      const result = yield* enrichers.run(kind, entryId).pipe(Effect.result)
      const finished = yield* Clock.currentTimeMillis
      if (result._tag === "Success") {
        yield* jobs.complete(id, finished)
        yield* Effect.logInfo(`${kind} ${entryId}: ${result.success}`)
        // New example sentences need voicing too.
        if (kind === "examples" && kinds.includes("audio")) yield* jobs.requeue("audio", entryId, priority, finished)
      } else {
        const retryAt = finished + 30_000 * 2 ** attempts
        yield* jobs.fail(id, String(result.failure), retryAt, finished)
        yield* Effect.logWarning(`${kind} ${entryId} failed (attempt ${attempts})`, result.failure)
      }
      return true
    })

    yield* step.pipe(
      Effect.flatMap((worked) => (worked ? Effect.void : Effect.sleep(Duration.millis(idle)))),
      Effect.forever
    )
  })
).pipe(Command.withDescription("Process enrichment requested on demand by the API"))
