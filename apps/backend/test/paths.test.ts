import { assert, describe, it } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadDotEnv } from "../src/runtime/Paths.ts"

describe("loadDotEnv", () => {
  it("loads .env then .env.local without overriding existing environment variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "kotori-dotenv-"))
    try {
      writeFileSync(join(dir, ".env"), "A=from-env\nB=from-env\nC=from-env\n")
      writeFileSync(join(dir, ".env.local"), "B=from-local\nC=from-local\n")
      const env: NodeJS.ProcessEnv = { C: "already-set" }
      loadDotEnv(dir, env)
      assert.strictEqual(env["A"], "from-env")
      assert.strictEqual(env["B"], "from-local")
      assert.strictEqual(env["C"], "already-set")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("skips a named-pipe .env when Nx has already loaded dotenv into process.env", () => {
    if (process.platform === "win32") return
    const dir = mkdtempSync(join(tmpdir(), "kotori-dotenv-fifo-"))
    try {
      const fifo = join(dir, ".env")
      const created = spawnSync("/usr/bin/mkfifo", [fifo])
      assert.strictEqual(created.status, 0)
      writeFileSync(join(dir, ".env.local"), "LOCAL_ONLY=yes\n")

      // Without the FIFO guard, opening a writerless named pipe with readFileSync blocks forever.
      const env: NodeJS.ProcessEnv = {
        NX_TASK_TARGET_PROJECT: "@kotori/backend",
        FROM_NX: "present"
      }
      loadDotEnv(dir, env)
      assert.strictEqual(env["FROM_NX"], "present")
      assert.strictEqual(env["LOCAL_ONLY"], "yes")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
