import { PgliteClient } from "@effect/sql-pglite"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Layer } from "effect"
import { Database } from "./Database.ts"
import { migrateDatabase } from "./Migrate.ts"
import { relations } from "./schema/relations.ts"

/**
 * A fresh in-memory Postgres (PGlite) for tests, migrated from `packages/db/migrations`
 * exactly as production is, with Drizzle and the Effect SQL client over it. Lives in its
 * own entry point so `@electric-sql/pglite` never enters the production module graph;
 * import it as `@kotori/db/testing`.
 */
export const DatabaseMemory = Layer.effectDiscard(migrateDatabase()).pipe(
  Layer.provideMerge(Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations }))),
  Layer.provideMerge(PgliteClient.layer({ dataDir: "memory://" }))
)
