import { defaultServerConditions, defineConfig } from "vite"

/** Shared Vitest config: resolve `@kotori/*` packages from source instead of their built `dist/`. */
export default defineConfig({
  resolve: { conditions: ["@kotori/source", ...defaultServerConditions] }
})
