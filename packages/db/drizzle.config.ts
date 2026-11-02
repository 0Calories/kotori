import { defineConfig } from "drizzle-kit"

// The repository's `.env.local` (written by the Neon CLI) and then `.env`, for the commands that
// connect (studio, introspect); variables already in the environment win, then the first file.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(new URL(`../../${file}`, import.meta.url))
  } catch {
    // Absent: nothing to load.
  }
}

/**
 * drizzle-kit: `pnpm --filter @kotori/db generate` diffs the tables in `src/` against the last
 * migration and writes the next one to `migrations/`; `kotori migrate` applies them. Only the
 * `public` schema is ours. `neon_auth` belongs to Managed Better Auth; the backend declares the
 * columns it reads, outside this package, so `generate` never diffs them (`schemaFilter` only
 * applies to introspect and push).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/tables.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori" },
  strict: true,
  verbose: true
})
