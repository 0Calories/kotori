import { join } from "node:path"
import { defaultServerConditions, defineConfig } from "vite"

const conditions = ["@kotori/source", ...defaultServerConditions]

/**
 * Shared Vitest config: resolve `@kotori/*` packages from source instead of their
 * built `dist/`. Workspace packages are externalized by the test server, so the
 * source condition must be set for external resolution too, or a stale `dist/`
 * would be loaded silently.
 *
 * `cacheDir` is per project (cwd = the project running vitest): the default is a
 * single root `node_modules/.vitest-cache`, which races when Nx runs suites in
 * parallel (ENOTEMPTY flakes seen locally and fatal for CI).
 */
export default defineConfig({
  cacheDir: join(process.cwd(), "node_modules", ".vitest-cache"),
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } }
})
