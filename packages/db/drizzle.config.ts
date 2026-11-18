import { defineConfig } from "drizzle-kit"
import { statSync } from "node:fs"

// The repository's `.env.local` (written by the Neon CLI) and then `.env`, for the commands that
// connect (studio, introspect); variables already in the environment win, then the first file.
const nxLoadedDotEnv =
  process.env["NX_TASK_TARGET_PROJECT"] !== undefined && process.env["NX_LOAD_DOT_ENV_FILES"] !== "false"
for (const file of [".env.local", ".env"]) {
  try {
    const url = new URL(`../../${file}`, import.meta.url)
    if (nxLoadedDotEnv && statSync(url).isFIFO()) continue
    process.loadEnvFile(url)
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
  schema: "./src/index.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori" },
  strict: true,
  verbose: true
})
