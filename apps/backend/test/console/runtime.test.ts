import { afterAll, describe, expect, it } from "vitest"
import type { LineLevel, Task } from "../../src/console/model/tasks.ts"
import { captureConsole, makeConsoleRuntime } from "../../src/console/runtime.ts"

const runtime = makeConsoleRuntime()
afterAll(() => runtime.dispose())

/** Runs `kotori <argv>` as the console's jobs list does, and waits for it to end. */
const run = (argv: ReadonlyArray<string>) =>
  new Promise<Task>((resolve) => {
    const id = runtime.runJob(argv)
    const unsubscribe = runtime.tasks.subscribe(() => {
      const task = runtime.tasks.getSnapshot().find((each) => each.id === id)
      if (task === undefined || task.status === "running") return
      unsubscribe()
      resolve(task)
    })
  })

describe("running a CLI command as a job", () => {
  it("runs it with the CLI's own parser and keeps what it prints", async () => {
    const task = await run(["--version"])
    expect(task.status).toBe("succeeded")
    expect(task.lines.map((line) => line.text)).toContain("kotori v0.1.0")
  })

  it("marks a command the CLI can't parse as failed, with the CLI's explanation in the log", async () => {
    const task = await run(["approve"])
    expect(task.status).toBe("failed")
    expect(task.lines.length).toBeGreaterThan(0)
  })

  it("marks an unknown command as failed", async () => {
    const task = await run(["no-such-command"])
    expect(task.status).toBe("failed")
  })
})

describe("capturing a command's console", () => {
  it("formats like Node's console and indents groups", () => {
    const lines: Array<[LineLevel, string]> = []
    const console = captureConsole((level, text) => lines.push([level, text]))
    console.log("Imported %d entries", 4000)
    console.group("Senses")
    console.error("one failed")
    console.groupEnd()
    console.warn({ table: "forms" })
    expect(lines).toEqual([
      ["out", "Imported 4000 entries"],
      ["out", "Senses"],
      ["error", "  one failed"],
      ["warn", "{ table: 'forms' }"]
    ])
  })
})
