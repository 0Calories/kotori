import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { PgliteClient } from "@effect/sql-pglite"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Effect, Layer, Stream } from "effect"
import { Database } from "../db/Database.ts"
import { migrateDatabase } from "../db/Migrate.ts"
import { Notifications } from "../db/Notifications.ts"
import { relations } from "../db/relations.ts"

const MigratedTemplate = Layer.effectDiscard(migrateDatabase()).pipe(
  Layer.provideMerge(Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations }))),
  Layer.provideMerge(PgliteClient.layer({ dataDir: "memory://", extensions: { pg_trgm } }))
)

let migratedDump: Promise<File | Blob> | undefined

const getMigratedDump = () =>
  (migratedDump ??= Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* PgliteClient.PgliteClient
        return yield* client.dumpDataDir("none")
      }).pipe(Effect.provide(MigratedTemplate))
    )
  ).catch((error) => {
    migratedDump = undefined
    throw error
  }))

/** `LISTEN` on PGlite, which delivers its own session's `NOTIFY`s as Postgres does. */
const NotificationsMemory = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const client = yield* PgliteClient.PgliteClient
    return Notifications.of({ listen: (channel) => Effect.map(client.listen(channel), Stream.fromQueue) })
  })
)

/**
 * A fresh in-memory Postgres (PGlite) for tests, migrated from `packages/db/migrations`
 * once per worker and cloned from its data-directory dump for each suite, with Drizzle and
 * the Effect SQL client and `LISTEN` over it. Only tests import it, so `@electric-sql/pglite` never
 * enters an entry point's module graph.
 */
export const DatabaseMemory = Layer.merge(
  Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations })),
  NotificationsMemory
).pipe(
  Layer.provideMerge(
    PgliteClient.layerFrom(
      Effect.flatMap(Effect.promise(getMigratedDump), (loadDataDir) =>
        PgliteClient.make({ dataDir: "memory://", loadDataDir, extensions: { pg_trgm } })
      )
    )
  )
)
