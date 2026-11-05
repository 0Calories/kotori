import { describe, expect, it } from "vitest"
import { keepBest, nearBest, toFullwidth, trigramFloor, trigramSimilarity, trigramTargets } from "../src/index.ts"

describe("trigramSimilarity", () => {
  it("scores as pg_trgm's similarity does", () => {
    expect(trigramSimilarity("umbrela", "umbrella")).toBeCloseTo(0.7)
    expect(trigramSimilarity("Cat", "cat")).toBe(1)
    expect(trigramSimilarity("cat", "dog")).toBe(0)
    expect(trigramSimilarity("", "cat")).toBe(0)
  })
})

describe("trigram targets", () => {
  it("leaves out queries too short to compare", () => {
    expect(trigramTargets("cta")).toEqual([])
    expect(trigramTargets("get on my nerves")).toEqual(["get on my nerves", "get on nerves"])
  })

  it("asks more of a phrase than of a word", () => {
    expect(trigramFloor("umbrela")).toBe(0)
    expect(trigramFloor("thin ise")).toBeGreaterThan(0)
  })

  it("keeps the matches near the best", () => {
    const matches = [{ similarity: 0.7 }, { similarity: 0.6 }, { similarity: 0.4 }]
    expect(nearBest(matches)).toEqual([{ similarity: 0.7 }, { similarity: 0.6 }])
    expect(nearBest(matches, 0.65)).toEqual([{ similarity: 0.7 }])
  })
})

describe("keepBest", () => {
  it("keeps each key's best hit, best first", () => {
    const hits = [
      { id: "a", score: 1 },
      { id: "b", score: 5 },
      { id: "a", score: 3 }
    ]
    expect(keepBest(hits, (hit) => hit.id)).toEqual([
      { id: "b", score: 5 },
      { id: "a", score: 3 }
    ])
  })
})

describe("toFullwidth", () => {
  it("widens ASCII", () => {
    expect(toFullwidth("CD")).toBe("ＣＤ")
  })
})
