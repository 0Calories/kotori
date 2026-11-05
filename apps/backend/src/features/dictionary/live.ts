import type { Entry, EntryId, EntryUpdate } from "@kotori/contracts"
import { Duration, Effect, Option, Stream } from "effect"
import type { EnrichmentUpdates } from "../enrichment/EnrichmentUpdates.ts"
import type { Dictionary } from "./Dictionary.ts"

/** How often a quiet stream says it's still there: well inside Fly's proxy idle timeout (60 s). */
export const KEEP_ALIVE = Duration.seconds(15)
/** How long one stream lasts at most. The app reconnects if it's still waiting, with a fresh sign-in. */
export const LIFETIME = Duration.minutes(5)

const onItsWay = (entry: Entry) => Object.values(entry.enrichment).includes("queued")

const sameEntry = (a: Entry, b: Entry) => JSON.stringify(a) === JSON.stringify(b)

/**
 * An entry's live updates: the entry as it stands, then again each time its enrichment moves on,
 * ending once nothing is on its way (or after `LIFETIME`), with keep-alives in between. Read-only:
 * like `Dictionary.entry`, watching queues nothing. Every learner sees the same dictionary entry,
 * so there is nobody else's data in it.
 */
export const liveEntry = (
  dictionary: Dictionary["Service"],
  updates: EnrichmentUpdates["Service"],
  id: EntryId
): Stream.Stream<EntryUpdate> =>
  Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before reading the entry, so an update landing in between isn't missed.
      const signals = yield* updates.subscribe
      const changed = signals.pipe(Stream.filter((signal) => signal === "resync" || signal === id))
      const entries = Stream.concat(Stream.succeed(undefined), changed).pipe(
        Stream.mapEffect(() => dictionary.entry(id)),
        // An entry removed while watched (a re-import) ends the stream.
        Stream.takeWhile(Option.isSome),
        Stream.map((entry) => entry.value),
        Stream.changesWith(sameEntry),
        Stream.takeUntil((entry) => !onItsWay(entry)),
        Stream.map((entry): EntryUpdate => ({ _tag: "Entry", entry }))
      )
      const keepAlives = Stream.tick(KEEP_ALIVE).pipe(
        Stream.drop(1),
        Stream.map((): EntryUpdate => ({ _tag: "KeepAlive" }))
      )
      return entries.pipe(
        Stream.merge(keepAlives, { haltStrategy: "left" }),
        Stream.interruptWhen(Effect.sleep(LIFETIME))
      )
    })
  )
