import { fileURLToPath } from "node:url"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { migrate } from "drizzle-orm/pg-core/effect"
import { Effect } from "effect"
import { Database } from "./Database.ts"

/** `packages/db/migrations`, next to both `src/` and the built `dist/`. */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url))

/**
 * Applies the migrations drizzle-kit generated into `migrationsFolder` that the database
 * has not seen yet, recorded in `drizzle.__drizzle_migrations`. Forward-only: a change is
 * a new migration, never an edit to an applied one. Driver-neutral, so the same Effect
 * migrates Postgres in production and PGlite in tests.
 */
export const migrateDatabase = Effect.fn("Database.migrate")(function* () {
  const db = yield* Database
  yield* migrate(readMigrationFiles({ migrationsFolder }), db._.session, { migrationsFolder })
})
