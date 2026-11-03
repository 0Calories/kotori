import { assert, afterEach, beforeEach, describe, it, vi } from "vitest"
import {
  SEARCH_THINKING_DELAY_MS,
  SEARCH_THINKING_MIN_MS,
  SEARCH_THINKING_SETTLE_MS,
  type SearchMascotPhase,
  createSearchMascotTiming
} from "../src/lib/searchMascot.ts"

const harness = () => {
  let clock = 0
  const seen: SearchMascotPhase[] = []
  const timing = createSearchMascotTiming(
    (phase) => {
      seen.push(phase)
    },
    () => clock
  )
  const advance = (ms: number) => {
    clock += ms
    vi.advanceTimersByTime(ms)
  }
  return { timing, seen, advance }
}

describe("the search mascot while a lookup is in flight", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("stays neutral when the load finishes before the delay", () => {
    const { timing, seen, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS - 1)
    assert.strictEqual(timing.phase, "neutral")
    timing.setLoading(false)
    advance(SEARCH_THINKING_SETTLE_MS + SEARCH_THINKING_DELAY_MS)
    assert.strictEqual(timing.phase, "neutral")
    assert.deepStrictEqual(seen, [])
  })

  it("switches to thinking only once the delay has passed, and not a moment sooner", () => {
    const { timing, seen, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS - 1)
    assert.strictEqual(timing.phase, "neutral")
    advance(1)
    assert.strictEqual(timing.phase, "thinking")
    assert.deepStrictEqual(seen, ["thinking"])
  })

  it("keeps thinking up for the minimum duration when the result lands just after it appears", () => {
    const { timing, seen, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS)
    timing.setLoading(false)
    advance(SEARCH_THINKING_MIN_MS - 1)
    assert.strictEqual(timing.phase, "thinking")
    advance(1)
    assert.strictEqual(timing.phase, "neutral")
    assert.deepStrictEqual(seen, ["thinking", "neutral"])
  })

  it("returns to neutral promptly once a long load ends, after the settle gap", () => {
    const { timing, seen, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS + SEARCH_THINKING_MIN_MS + 250)
    timing.setLoading(false)
    advance(SEARCH_THINKING_SETTLE_MS - 1)
    assert.strictEqual(timing.phase, "thinking")
    advance(1)
    assert.strictEqual(timing.phase, "neutral")
    assert.deepStrictEqual(seen, ["thinking", "neutral"])
  })

  it("does not postpone thinking when the same load reports in again", () => {
    const { timing, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS - 50)
    timing.setLoading(true)
    advance(50)
    assert.strictEqual(timing.phase, "thinking")
  })

  it("treats a short gap as the same wait, so keystrokes don't restart the delay", () => {
    const { timing, seen, advance } = harness()
    const gap = SEARCH_THINKING_SETTLE_MS - 1
    timing.setLoading(true)
    advance(100)
    timing.setLoading(false)
    advance(gap)
    timing.setLoading(true)
    advance(100)
    timing.setLoading(false)
    advance(30)
    timing.setLoading(true)
    const elapsed = 100 + gap + 100 + 30
    assert.strictEqual(elapsed < SEARCH_THINKING_DELAY_MS, true)
    advance(SEARCH_THINKING_DELAY_MS - elapsed)
    assert.strictEqual(timing.phase, "thinking")
    assert.deepStrictEqual(seen, ["thinking"])
  })

  it("starts a fresh delay after a gap long enough to be a new lookup", () => {
    const { timing, advance } = harness()
    timing.setLoading(true)
    advance(300)
    timing.setLoading(false)
    advance(SEARCH_THINKING_SETTLE_MS)
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS - 1)
    assert.strictEqual(timing.phase, "neutral")
    advance(1)
    assert.strictEqual(timing.phase, "thinking")
  })

  it("does not blink neutral when a new request replaces one that is already showing thinking", () => {
    const { timing, seen, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS + SEARCH_THINKING_MIN_MS + 100)
    timing.setLoading(false)
    advance(SEARCH_THINKING_SETTLE_MS - 1)
    timing.setLoading(true)
    advance(SEARCH_THINKING_SETTLE_MS)
    assert.strictEqual(timing.phase, "thinking")
    assert.deepStrictEqual(seen, ["thinking"])
    timing.setLoading(false)
    advance(SEARCH_THINKING_SETTLE_MS)
    assert.strictEqual(timing.phase, "neutral")
    assert.deepStrictEqual(seen, ["thinking", "neutral"])
  })

  it("keeps the original minimum when a second load starts and ends during the hold", () => {
    const { timing, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS)
    timing.setLoading(false)
    advance(40)
    timing.setLoading(true)
    advance(20)
    timing.setLoading(false)
    advance(SEARCH_THINKING_MIN_MS - 60 - 1)
    assert.strictEqual(timing.phase, "thinking")
    advance(1)
    assert.strictEqual(timing.phase, "neutral")
  })

  it("stays neutral through a run of fast loads, and through a load that errors or is cleared before the delay", () => {
    const { timing, seen, advance } = harness()
    for (let i = 0; i < 8; i++) {
      timing.setLoading(true)
      advance(180)
      timing.setLoading(false)
      advance(SEARCH_THINKING_SETTLE_MS)
    }
    timing.setLoading(true)
    advance(120)
    timing.setLoading(false)
    advance(10_000)
    assert.strictEqual(timing.phase, "neutral")
    assert.deepStrictEqual(seen, [])
  })

  it("returns to neutral after a slow load fails, and a later lookup waits out a new delay", () => {
    const { timing, seen, advance } = harness()
    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS + 1_000)
    timing.setLoading(false)
    advance(SEARCH_THINKING_SETTLE_MS)
    assert.strictEqual(timing.phase, "neutral")
    advance(5_000)
    assert.deepStrictEqual(seen, ["thinking", "neutral"])

    timing.setLoading(true)
    advance(SEARCH_THINKING_DELAY_MS - 1)
    assert.strictEqual(timing.phase, "neutral")
    advance(1)
    assert.strictEqual(timing.phase, "thinking")
    assert.deepStrictEqual(seen, ["thinking", "neutral", "thinking"])
  })

  it("drops a pending pose change when disposed, and ignores later updates", () => {
    const pending = harness()
    pending.timing.setLoading(true)
    pending.timing.dispose()
    pending.advance(SEARCH_THINKING_DELAY_MS + SEARCH_THINKING_MIN_MS)
    pending.timing.setLoading(false)
    assert.deepStrictEqual(pending.seen, [])
    assert.strictEqual(pending.timing.phase, "neutral")

    const shown = harness()
    shown.timing.setLoading(true)
    shown.advance(SEARCH_THINKING_DELAY_MS)
    shown.timing.setLoading(false)
    shown.timing.dispose()
    shown.advance(SEARCH_THINKING_MIN_MS + SEARCH_THINKING_SETTLE_MS)
    assert.deepStrictEqual(shown.seen, ["thinking"])
    assert.strictEqual(shown.timing.phase, "thinking")
  })
})
