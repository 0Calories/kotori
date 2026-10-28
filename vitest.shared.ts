import { join } from "node:path"
import { defaultServerConditions } from "vite"
import { defineConfig } from "vitest/config"

const conditions = ["@kotori/source", ...defaultServerConditions]

/**
 * Shared Vitest config: resolve `@kotori/*` packages from source instead of their
 * built `dist/`. Workspace packages are externalized by the test server, so the
 * source condition must be set for external resolution too, or a stale `dist/`
 * would be loaded silently.
 *
 * `cacheDir` is per project (cwd = the project running vitest): a single shared
 * cache directory races when Nx runs suites in parallel.
 *
 * `hookTimeout` covers `layer(...)` setup, where suites on `DatabaseMemory` start PGlite
 * and apply every migration: 5-10 s each on a CI runner with Nx's suites in parallel,
 * against Vitest's 10 s default.
 */
export default defineConfig({
  cacheDir: join(process.cwd(), "node_modules", ".vitest-cache"),
  test: { hookTimeout: 60_000 },
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } }
})
