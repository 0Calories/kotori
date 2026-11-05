import { describe, expect, it } from "vitest"
import { databaseTarget, describeUrl } from "../../src/console/model/environment.ts"
import { ago, duration, fit, since, truncate, width } from "../../src/console/model/format.ts"
import { MAX_LINES, TaskStore, toLines } from "../../src/console/model/tasks.ts"

describe("where the console points", () => {
  it("names a local database by host and port, and calls it local", () => {
    expect(databaseTarget({ DATABASE_URL: "postgres://kotori:kotori@localhost:55433/kotori" })).toEqual({
      label: "localhost:55433",
      host: "localhost:55433",
      local: true,
      configured: true,
      unreadable: false
    })
  })

  it("names a Neon database by its endpoint, treats it as live, and never shows the credentials", () => {
    const url =
      "postgresql://owner:s3cret-pass@ep-quiet-meadow-a1b2c3d4-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require"
    const target = databaseTarget({ DATABASE_URL: `"${url}"` })
    expect(target.label).toBe("ep-quiet-meadow-a1b2c3d4 (Neon)")
    expect(target.local).toBe(false)
    expect(JSON.stringify(target)).not.toContain("s3cret")
    expect(JSON.stringify(target)).not.toContain("owner")
  })

  it("falls back to Kotori's default when DATABASE_URL is unset, as the backend does", () => {
    expect(databaseTarget({})).toMatchObject({ label: "localhost:5432", local: true, configured: false })
  })

  it("says nothing about a URL it can't read, rather than echoing it", () => {
    const target = describeUrl("not a url but maybe a secret", "postgres://localhost:5432/kotori")
    expect(target).toMatchObject({ unreadable: true, local: false })
    expect(JSON.stringify(target)).not.toContain("secret")
  })
})

describe("a run's log", () => {
  it("splits output into lines without colour codes", () => {
    expect(toLines("\u001b[1mBold\u001b[0m\r\nsecond  \n")).toEqual(["Bold", "second", ""])
  })

  it("publishes changes once per tick, newest run first, and keeps a long log bounded", () => {
    let flush: (() => void) | undefined
    const store = new TaskStore(
      (next) => void (flush = next),
      () => 1000
    )
    const heard: Array<number> = []
    store.subscribe(() => heard.push(store.getSnapshot().length))

    const first = store.start(["migrate"])
    const second = store.start(["status"])
    store.append(first, "out", "Applying migrations")
    expect(heard).toEqual([])
    flush?.()
    expect(heard).toEqual([2])
    expect(store.getSnapshot().map((task) => task.id)).toEqual([second, first])

    for (let n = 0; n < MAX_LINES + 10; n++) store.append(second, "out", `line ${n}`)
    store.finish(second, "failed", "It broke.")
    store.flush()
    const [latest] = store.getSnapshot()
    expect(latest).toMatchObject({ status: "failed", failure: "It broke.", dropped: 10, endedAt: 1000 })
    expect(latest?.lines[0]?.text).toBe("line 10")

    store.clearFinished()
    store.flush()
    expect(store.getSnapshot().map((task) => task.id)).toEqual([first])
  })
})

describe("laying text out in columns", () => {
  it("counts Japanese as two columns", () => {
    expect(width("推し活")).toBe(6)
    expect(width("rizz")).toBe(4)
    expect(fit("推し活", 8)).toBe("推し活  ")
    expect(truncate("おしかつ", 5)).toBe("おし…")
    expect(fit("5", 3, "right")).toBe("  5")
  })

  it("says when things happened and how long they took", () => {
    const now = Date.parse("2026-11-05T12:00:00Z")
    expect(ago(new Date(now - 20_000), now)).toBe("now")
    expect(since(new Date(now - 20_000), now)).toBe("just now")
    expect(since(new Date(now - 3 * 3600_000), now)).toBe("3h ago")
    expect(since(new Date("2026-09-01T00:00:00Z"), now)).toBe("on 2026-09-01")
    expect(duration(42)).toBe("42ms")
    expect(duration(4200)).toBe("4.2s")
    expect(duration(185_000)).toBe("3m 05s")
  })
})
