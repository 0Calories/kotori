import { defaultServerConditions, defineConfig } from "vite"

const conditions = ["@kotori/source", ...defaultServerConditions]

/**
 * Shared Vitest config: resolve `@kotori/*` packages from source instead of their
 * built `dist/`. Workspace packages are externalized by the test server, so the
 * source condition must be set for external resolution too, or a stale `dist/`
 * would be loaded silently.
 */
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } }
})
