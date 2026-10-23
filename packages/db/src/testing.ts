import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite"
import { Layer, String } from "effect"
import { migrations } from "./migrations.ts"

/**
 * A fresh, fully migrated in-memory Postgres (PGlite), for tests.
 * Lives in its own entry point so `@electric-sql/pglite` never enters the
 * production module graph; import it as `@kotori/db/testing`.
 */
export const DatabaseMemory = PgliteMigrator.layer({ loader: PgliteMigrator.fromRecord(migrations) }).pipe(
  Layer.provideMerge(
    PgliteClient.layer({
      dataDir: "memory://",
      transformResultNames: String.snakeToCamel,
      transformQueryNames: String.camelToSnake
    })
  )
)
