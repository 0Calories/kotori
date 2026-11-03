import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { PgliteClient } from "@effect/sql-pglite"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Layer } from "effect"
import { Database } from "../db/Database.ts"
import { migrateDatabase } from "../db/Migrate.ts"
import { relations } from "../db/relations.ts"

/**
 * A fresh in-memory Postgres (PGlite) for tests, migrated from `packages/db/migrations`
 * exactly as production is, with Drizzle and the Effect SQL client over it. Only tests
 * import it, so `@electric-sql/pglite` never enters an entry point's module graph.
 */
export const DatabaseMemory = Layer.effectDiscard(migrateDatabase()).pipe(
  Layer.provideMerge(Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations }))),
  Layer.provideMerge(PgliteClient.layer({ dataDir: "memory://", extensions: { pg_trgm } }))
)
