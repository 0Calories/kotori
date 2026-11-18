import { join } from "node:path"
import { defaultServerConditions } from "vite"
import { defineConfig } from "vitest/config"

const conditions = ["@kotori/source", ...defaultServerConditions]

export default defineConfig({
  // Per-project cache directory so parallel Nx test targets don't race on a shared cache.
  cacheDir: join(process.cwd(), "node_modules", ".vitest-cache"),
  // `isolate: false` reuses `DatabaseMemory`'s migrated PGlite snapshot per worker; `hookTimeout` covers first-run CI migrations.
  test: { hookTimeout: 60_000, isolate: false },
  resolve: { conditions },
  // Workspace packages are externalized by Vite's SSR runner, so `externalConditions` prevents loading stale `dist/` builds.
  ssr: { resolve: { conditions, externalConditions: conditions } }
})
