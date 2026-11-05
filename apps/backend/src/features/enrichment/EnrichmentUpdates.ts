import { EntryId } from "@kotori/db"
import { sql } from "drizzle-orm"
import { Cause, Context, Duration, Effect, Layer, PubSub, Schedule, type Scope, Stream } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { Notifications } from "../../db/Notifications.ts"

// The worker and the API are separate processes (Fly runs each on its own machines), so the
// worker says an entry's enrichment moved on with a Postgres NOTIFY, and each API process holds
// one LISTEN that fans out to the entries' live updates in memory.

const CHANNEL = "kotori_enrichment"

/**
 * Something about enrichment changed: one entry's (its id), or possibly any entry's, after the
 * API's listener reconnected and may have missed some (`"resync"`).
 */
export type EnrichmentSignal = EntryId | "resync"

/** Waits between tries to listen again: 1 s doubling, at most 30 s. */
const RELISTEN = Schedule.min([Schedule.exponential(Duration.seconds(1)), Schedule.spaced(Duration.seconds(30))])

/**
 * Tells every API process that an entry's enrichment moved on (a job finished or failed). Postgres
 * delivers it once the statement commits. Never fails: the entry's watchers miss one update, which
 * reconnecting makes up for, and that's no reason to fail the job.
 */
export const announceEnrichment = (db: DatabaseShape, entryId: EntryId) =>
  db.execute(sql`SELECT pg_notify(${CHANNEL}, ${String(entryId)})`).pipe(
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.logWarning(`Couldn't announce enrichment of ${entryId}`, cause))
  )

const signalOf = (payload: string): EnrichmentSignal | undefined => {
  const id = Number(payload)
  return Number.isSafeInteger(id) && id > 0 ? EntryId.make(id) : undefined
}

/** The enrichment signals reaching this API process, for entries' live updates. */
export class EnrichmentUpdates extends Context.Service<
  EnrichmentUpdates,
  {
    /** Every signal from now until the scope closes. */
    readonly subscribe: Effect.Effect<Stream.Stream<EnrichmentSignal>, never, Scope.Scope>
  }
>()("@kotori/backend/EnrichmentUpdates") {
  /**
   * Listens on the channel for as long as the layer lives, listening again whenever the
   * connection drops. A listener that's down only delays updates: the app reconnects to the live
   * updates now and then, and each connection starts with the entry as it stands.
   */
  static readonly layer = Layer.effect(
    EnrichmentUpdates,
    Effect.gen(function* () {
      const notifications = yield* Notifications
      // Every watcher refreshes on any signal it gets, so a slow one can lose old signals.
      const signals = yield* Effect.acquireRelease(PubSub.sliding<EnrichmentSignal>(1024), PubSub.shutdown)

      const session = Effect.scoped(
        Effect.gen(function* () {
          const payloads = yield* notifications.listen(CHANNEL)
          // Whatever was announced while this process wasn't listening is lost: everyone looks again.
          yield* PubSub.publish(signals, "resync")
          yield* Stream.runForEach(payloads, (payload) => {
            const signal = signalOf(payload)
            return signal === undefined ? Effect.void : PubSub.publish(signals, signal)
          })
        })
      )
      yield* session.pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterrupts(cause) ? Effect.void : Effect.logWarning("Stopped hearing about enrichment", cause)
        ),
        Effect.retry(RELISTEN),
        // Listening ended without an error (the queue shut down): listen again.
        Effect.repeat(Schedule.spaced(Duration.seconds(1))),
        Effect.forkScoped
      )

      return EnrichmentUpdates.of({
        subscribe: Effect.map(PubSub.subscribe(signals), Stream.fromSubscription)
      })
    })
  )
}
