import { describe, expect, it } from "vitest"
import { normalizeGloss, normalizeJapaneseGloss } from "../src/index.ts"

describe("normalizeGloss", () => {
  it("strips infinitive markers, articles and parentheticals", () => {
    expect(normalizeGloss("to eat (a meal)")).toBe("eat")
    expect(normalizeGloss("The Sun")).toBe("sun")
    expect(normalizeGloss("(of a person) to be late")).toBe("be late")
    expect(normalizeGloss("to rattle one’s nerves")).toBe("rattle one's nerves")
  })
})

describe("normalizeJapaneseGloss", () => {
  it("strips asides, the object marker and closing punctuation", () => {
    expect(normalizeJapaneseGloss("～を食べる。")).toBe("食べる")
    expect(normalizeJapaneseGloss("（資源や金銭を）消費する")).toBe("消費する")
    expect(normalizeJapaneseGloss("…に『火をつける』")).toBe("火をつける")
    expect(normalizeJapaneseGloss("〈C〉『明かり』(太陽・灯火など光を出すもの)")).toBe("明かり")
  })

  it("keeps a leading particle that isn't the object marker", () => {
    // Only after a tilde is a leading particle the object marker; とても keeps its と.
    expect(normalizeJapaneseGloss("とても")).toBe("とても")
  })
})
