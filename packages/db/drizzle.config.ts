import { defineConfig } from "drizzle-kit"
import { statSync } from "node:fs"

const nxLoadedDotEnv =
  process.env["NX_TASK_TARGET_PROJECT"] !== undefined && process.env["NX_LOAD_DOT_ENV_FILES"] !== "false"
for (const file of [".env.local", ".env"]) {
  try {
    const url = new URL(`../../${file}`, import.meta.url)
    if (nxLoadedDotEnv && statSync(url).isFIFO()) continue
    process.loadEnvFile(url)
  } catch {}
}

// drizzle-kit's `schemaFilter` only applies to `introspect` and `push`, so `neon_auth` tables are declared outside this package.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/index.ts",
  out: "./migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori" },
  strict: true,
  verbose: true
})
