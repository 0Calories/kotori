import { and, eq, or } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { pgSchema, text } from "drizzle-orm/pg-core"
import { migrate } from "drizzle-orm/pg-core/effect"
import { Effect, Schema } from "effect"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { Database } from "./Database.ts"

export const migrationsFolder = join(
  dirname(createRequire(import.meta.url).resolve("@kotori/db/package.json")),
  "migrations"
)

export class LegacySchemaError extends Schema.TaggedError<LegacySchemaError>()("LegacySchemaError", {
  message: Schema.String
}) {}

// Declared outside @kotori/db so drizzle-kit never generates migrations for information_schema.
const catalogTables = pgSchema("information_schema").table("tables", {
  schema: text("table_schema").notNull(),
  name: text("table_name").notNull()
})

const legacyHistory = and(eq(catalogTables.schema, "public"), eq(catalogTables.name, "effect_sql_migrations"))
const drizzleHistory = and(eq(catalogTables.schema, "drizzle"), eq(catalogTables.name, "__drizzle_migrations"))

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
