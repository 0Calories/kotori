import { assert, describe, it } from "@effect/vitest"
import { EntryId } from "@kotori/contracts"
import { Effect, Layer, Queue, Stream } from "effect"
import { SqlError } from "effect/sql"
import { TestClock } from "effect/testing"
import { Notifications } from "../../src/db/Notifications.ts"
import { type EnrichmentSignal, EnrichmentUpdates } from "../../src/features/enrichment/EnrichmentUpdates.ts"

/** A channel whose connection the test controls: each LISTEN gets its own queue of payloads. */
const flakyChannel = Effect.gen(function* () {
  const connections = yield* Queue.unbounded<Queue.Queue<string, SqlError.SqlError>>()
  const layer = Layer.succeed(
    Notifications,
    Notifications.of({
      listen: () =>
        Effect.gen(function* () {
          const payloads = yield* Queue.unbounded<string, SqlError.SqlError>()
          yield* Queue.offer(connections, payloads)
          return Stream.fromQueue(payloads)
        })
    })
  )
  return { connections, layer }
})

describe("EnrichmentUpdates", () => {
  it.effect("fans entry ids out to subscribers and listens again after the connection drops", () =>
    Effect.gen(function* () {
      const channel = yield* flakyChannel
      yield* Effect.gen(function* () {
        const updates = yield* EnrichmentUpdates
        const first = yield* Queue.take(channel.connections)
        const heard = yield* Queue.unbounded<EnrichmentSignal>()
        yield* (yield* updates.subscribe).pipe(
          Stream.runForEach((signal) => Queue.offer(heard, signal)),
          Effect.forkChild
        )
        yield* Effect.yieldNow

        yield* Queue.offerAll(first, ["1358280", "not an id", "-4", "1269130"])
        assert.deepStrictEqual(
          [yield* Queue.take(heard), yield* Queue.take(heard)],
          [EntryId.make(1358280), EntryId.make(1269130)]
        )

        // The connection drops: after a second it listens again, and everyone looks again for
        // whatever was announced in between.
        yield* Queue.fail(first, new SqlError.SqlError({ reason: new SqlError.ConnectionError({ cause: "gone" }) }))
        yield* TestClock.adjust("1 second")
        const second = yield* Queue.take(channel.connections)
        assert.strictEqual(yield* Queue.take(heard), "resync")
        yield* Queue.offer(second, "1594790")
        assert.strictEqual(yield* Queue.take(heard), EntryId.make(1594790))
      }).pipe(Effect.provide(EnrichmentUpdates.layer.pipe(Layer.provide(channel.layer))))
    })
  )
})
