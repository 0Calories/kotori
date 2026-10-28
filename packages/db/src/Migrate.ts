import { fileURLToPath } from "node:url"
import { and, eq, or } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { pgSchema, text } from "drizzle-orm/pg-core"
import { migrate } from "drizzle-orm/pg-core/effect"
import { Effect, Schema } from "effect"
import { Database } from "./Database.ts"

/** `packages/db/migrations`, next to both `src/` and the built `dist/`. */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url))

/**
 * The database still has the hand-written schema from before the Drizzle rebuild, which
 * the Effect SQL migrator recorded in `effect_sql_migrations`. Drizzle's first migration
 * would fail on its existing tables, so `migrateDatabase` stops before trying.
 */
export class LegacySchemaError extends Schema.TaggedError<LegacySchemaError>()("LegacySchemaError", {
  message: Schema.String
}) {}

/** Postgres' catalog of tables, read-only; outside `./schema`, so drizzle-kit never sees it. */
const catalogTables = pgSchema("information_schema").table("tables", {
  schema: text("table_schema").notNull(),
  name: text("table_name").notNull()
})

const legacyHistory = and(eq(catalogTables.schema, "public"), eq(catalogTables.name, "effect_sql_migrations"))
const drizzleHistory = and(eq(catalogTables.schema, "drizzle"), eq(catalogTables.name, "__drizzle_migrations"))

/**
 * Applies the migrations drizzle-kit generated into `migrationsFolder` that the database
 * has not seen yet, recorded in `drizzle.__drizzle_migrations`. Forward-only: a change is
 * a new migration, never an edit to an applied one. Driver-neutral, so the same Effect
 * migrates Postgres in production and PGlite in tests.
 *
 * Fails with `LegacySchemaError`, changing nothing, on a database that has the old
 * `effect_sql_migrations` history and no Drizzle one.
 */
export const migrateDatabase = Effect.fn("Database.migrate")(function* () {
  const db = yield* Database
  const histories = yield* db
    .select({ schema: catalogTables.schema })
    .from(catalogTables)
    .where(or(legacyHistory, drizzleHistory))
    .pipe(Effect.orDie)
  const has = (schema: string) => histories.some((row) => row.schema === schema)
  if (has("public") && !has("drizzle")) {
    return yield* new LegacySchemaError({
      message:
        "This database has the schema from before the Drizzle rebuild (an effect_sql_migrations table and no " +
        "drizzle.__drizzle_migrations), so the new migrations can't be applied on top of it."
    })
  }
  yield* migrate(readMigrationFiles({ migrationsFolder }), db._.session, { migrationsFolder })
})
