import { defineConfig } from "drizzle-kit"
import { loadDotEnv } from "./src/Paths.ts"

loadDotEnv()

/**
 * drizzle-kit: `pnpm --filter @kotori/db generate` diffs `src/schema` against the last
 * migration and writes the next one to `migrations/`; `kotori migrate` applies them.
 * Only the `public` schema is ours. `neon_auth` belongs to Managed Better Auth; its
 * read-only declarations live outside the `schema` path below so `generate` never diffs
 * them (`schemaFilter` only applies to introspect and push).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori" },
  strict: true,
  verbose: true
})
