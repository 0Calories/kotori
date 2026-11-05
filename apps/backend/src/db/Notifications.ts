import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer, type Scope, Stream } from "effect"
import type { SqlError } from "effect/sql"

/**
 * Postgres `LISTEN`: the payloads `NOTIFY`ed on a channel by any process using the database.
 * Postgres delivers a notification when the sending transaction commits, to every session
 * listening then; nothing is stored, so a listener that wasn't connected misses it.
 *
 * Needs a session that lasts: on Neon, the direct connection string, not the `-pooler` one
 * (its PgBouncer runs in transaction mode, which doesn't support `LISTEN`).
 */
export class Notifications extends Context.Service<
  Notifications,
  {
    /**
     * Listens on `channel` once Postgres confirms `LISTEN`, until the scope closes. The stream
     * fails when the connection drops (a restart, a Neon compute suspending), so listen again.
     */
    readonly listen: (
      channel: string
    ) => Effect.Effect<Stream.Stream<string, SqlError.SqlError>, SqlError.SqlError, Scope.Scope>
  }
>()("@kotori/backend/Notifications") {
  /** Over the `PgClient` in scope; each listener holds one of its pooled connections. */
  static readonly layer = Layer.effect(
    Notifications,
    Effect.gen(function* () {
      const client = yield* PgClient.PgClient
      return Notifications.of({
        listen: (channel) =>
          Effect.map(client.listen(channel), (queue) =>
            Stream.fromQueue(queue).pipe(Stream.map((notification) => notification.payload))
          )
      })
    })
  )
}
