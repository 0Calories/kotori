import { describe, expect, it } from "vitest"
import { inOtherLanguage, normalizeAsk } from "../src/index.ts"

describe("normalizeAsk", () => {
  it("folds width and case, and strips stray punctuation and emoji around the words", () => {
    expect(normalizeAsk("  Bussin!! 🔥", "en")).toBe("bussin")
    expect(normalizeAsk("ｂｕｓｓｉｎ", "en")).toBe("bussin")
    expect(normalizeAsk("what's up?", "en")).toBe("what's up")
    expect(normalizeAsk("それな！", "ja")).toBe("それな")
    expect(normalizeAsk("Shibuya", "ja")).toBe("Shibuya")
  })
})

describe("inOtherLanguage", () => {
  it("is Japanese script asked of the English dictionary", () => {
    expect(inOtherLanguage("食べる", "en")).toBe(true)
    expect(inOtherLanguage("bussin", "en")).toBe(false)
  })

  it("is Latin words that aren't rōmaji asked of the Japanese dictionary", () => {
    expect(inOtherLanguage("umbrella", "ja")).toBe(true)
    expect(inOtherLanguage("brainrot", "ja")).toBe(true)
    expect(inOtherLanguage("sorena", "ja")).toBe(false)
    expect(inOtherLanguage("matcha", "ja")).toBe(false)
    expect(inOtherLanguage("kon'nichiwa", "ja")).toBe(false)
    expect(inOtherLanguage("それな", "ja")).toBe(false)
    // Not language at all: another check's business.
    expect(inOtherLanguage("12345", "ja")).toBe(false)
    expect(inOtherLanguage("<b>", "ja")).toBe(false)
  })
})
