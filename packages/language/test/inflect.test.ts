import { describe, expect, it } from "vitest"
import { uninflect } from "../src/index.ts"

describe("uninflect", () => {
  it.each([
    ["parties", "party"],
    ["boxes", "box"],
    ["teams", "team"],
    ["stopped", "stop"],
    ["baked", "bake"],
    ["running", "run"],
    ["making", "make"],
    ["lying", "lie"],
    ["bigger", "big"],
    ["happiest", "happy"]
  ])("%s -> %s", (word, base) => {
    expect(uninflect(word).map((candidate) => candidate.base)).toContain(base)
  })

  it("leaves -ss words whole", () => {
    expect(uninflect("glass").map((candidate) => candidate.base)).not.toContain("glas")
  })
})
