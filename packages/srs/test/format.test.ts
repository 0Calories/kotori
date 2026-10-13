import { describe, expect, it } from "vitest"
import { formatDays, formatDelay } from "../src/index.ts"

describe("formatting", () => {
  it("labels delays like Anki's answer buttons", () => {
    expect(formatDelay(30_000)).toBe("<1m")
    expect(formatDelay(60_000)).toBe("1m")
    expect(formatDelay(10 * 60_000)).toBe("10m")
    expect(formatDelay(90 * 60_000)).toBe("1.5h")
  })

  it("labels intervals in days, months and years", () => {
    expect(formatDays(1)).toBe("1d")
    expect(formatDays(25)).toBe("25d")
    expect(formatDays(36)).toBe("1.2mo")
    expect(formatDays(840)).toBe("2.3y")
  })
})
