import { PgliteClient } from "@effect/sql-pglite"
import * as PgliteDrizzle from "drizzle-orm/effect-pglite"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { Database } from "./Database.ts"
import { migrateDatabase } from "./Migrate.ts"
import { relations } from "./schema/relations.ts"

/**
 * The slice of Managed Auth's `neon_auth` schema that `../neonAuth.ts` declares. Neon
 * creates and migrates the real one in every database Kotori runs on, so tests get this
 * stand-in, with the same names and constraints, for fakes of Managed Auth to write to.
 */
const createNeonAuth = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE SCHEMA neon_auth`
  yield* sql`CREATE TABLE neon_auth."user" (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    "emailVerified" boolean NOT NULL DEFAULT false,
    name text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  )`
  yield* sql`CREATE TABLE neon_auth.session (
    id text PRIMARY KEY,
    "userId" uuid NOT NULL REFERENCES neon_auth."user" (id) ON DELETE CASCADE,
    "expiresAt" timestamptz NOT NULL
  )`
}).pipe(Effect.orDie)

/**
 * A fresh in-memory Postgres (PGlite) for tests, migrated from `packages/db/migrations`
 * exactly as production is, plus a stand-in for `neon_auth`, with Drizzle and the Effect
 * SQL client over it. Lives in its own entry point so `@electric-sql/pglite` never enters
 * the production module graph; import it as `@kotori/db/testing`.
 */
export const DatabaseMemory = Layer.effectDiscard(Effect.andThen(migrateDatabase(), createNeonAuth)).pipe(
  Layer.provideMerge(Layer.effect(Database, PgliteDrizzle.makeWithDefaults({ relations }))),
  Layer.provideMerge(PgliteClient.layer({ dataDir: "memory://" }))
)
