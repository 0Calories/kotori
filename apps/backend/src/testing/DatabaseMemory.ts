import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { PgliteClient } from "@effect/sql-pglite"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Effect, Layer } from "effect"
import { Database } from "../db/Database.ts"
import { migrateDatabase } from "../db/Migrate.ts"
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

/**
 * A fresh in-memory Postgres (PGlite) for tests, migrated from `packages/db/migrations`
 * once per worker and cloned from its data-directory dump for each suite, with Drizzle and
 * the Effect SQL client over it. Only tests import it, so `@electric-sql/pglite` never
 * enters an entry point's module graph.
 */
export const DatabaseMemory = Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations })).pipe(
  Layer.provideMerge(
    PgliteClient.layerFrom(
      Effect.flatMap(Effect.promise(getMigratedDump), (loadDataDir) =>
        PgliteClient.make({ dataDir: "memory://", loadDataDir, extensions: { pg_trgm } })
      )
    )
  )
)
