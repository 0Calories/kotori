import { defineConfig } from "vitest/config"

export default defineConfig({
  // The config is loaded from the repo root (`vitest --config tools/vitest.config.ts`),
  // so pin the project root to this directory or the test file is not discovered.
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["file-token-limit.test.ts"]
  }
})
