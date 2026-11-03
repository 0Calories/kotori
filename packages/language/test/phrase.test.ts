import { describe, expect, it } from "vitest"
import {
  englishPhraseVariants,
  englishSearchTerms,
  normalizeEnglishPhrase,
  relaxedEnglishSearchTerms
} from "../src/index.ts"

describe("normalizeEnglishPhrase", () => {
  it("strips idiom placeholders and articles while keeping single filler words intact", () => {
    expect(normalizeEnglishPhrase("to get on one's nerves")).toBe("get on nerves")
    expect(normalizeEnglishPhrase("to get on someone's nerves")).toBe("get on nerves")
    expect(normalizeEnglishPhrase("get on my nerves")).toBe("get on nerves")
    expect(normalizeEnglishPhrase("get on nerves")).toBe("get on nerves")
    expect(normalizeEnglishPhrase("let the cat out of the bag")).toBe("let cat out of bag")
    expect(normalizeEnglishPhrase("someone")).toBe("someone")
  })
})

describe("englishPhraseVariants", () => {
  it("connects pronoun, placeholder and omitted-pronoun forms of idioms", () => {
    expect(englishPhraseVariants("eat")).toEqual(["eat"])
    expect(englishPhraseVariants("get on my nerves")).toEqual(
      expect.arrayContaining([
        "get on my nerves",
        "get on nerves",
        "get on one's nerves",
        "get on someone's nerves",
        "get on somebody's nerves"
      ])
    )
    expect(englishPhraseVariants("get on nerves")).toEqual(
      expect.arrayContaining(["get on nerves", "get on one's nerves", "get on someone's nerves"])
    )
    expect(englishPhraseVariants("wrap head around")).toEqual(
      expect.arrayContaining(["wrap head around", "wrap one's head around"])
    )
    expect(englishPhraseVariants("beat around bush")).toEqual(
      expect.arrayContaining(["beat around bush", "beat around the bush"])
    )
  })
})

describe("englishPhraseVariants, both ways round", () => {
  it("swaps any pronoun or placeholder for any other of its kind", () => {
    expect(englishPhraseVariants("get on one's nerves")).toEqual(expect.arrayContaining(["get on my nerves"]))
    expect(englishPhraseVariants("tell her off")).toEqual(expect.arrayContaining(["tell someone off", "tell his off"]))
    expect(englishPhraseVariants("pull myself together")).toEqual(
      expect.arrayContaining(["pull oneself together", "pull yourself together"])
    )
  })

  it("swaps an object only for objects", () => {
    const variants = englishPhraseVariants("make me laugh")
    expect(variants).toEqual(expect.arrayContaining(["make someone laugh", "make one laugh"]))
    expect(variants).not.toContain("make one's laugh")
  })

  it("restores fillers left out in both slots", () => {
    expect(englishPhraseVariants("let cat out of bag")).toContain("let the cat out of the bag")
    expect(englishPhraseVariants("let the cat out of bag")).toContain("let the cat out of the bag")
    expect(englishPhraseVariants("pull together")).toContain("pull oneself together")
    expect(englishPhraseVariants("tell off")).toContain("tell someone off")
  })
})

describe("englishSearchTerms", () => {
  it("drops idiom placeholders while other words remain", () => {
    expect(englishSearchTerms("get on one's nerves")).toBe("get on nerves")
    expect(englishSearchTerms("Get on someone’s nerves")).toBe("get on nerves")
    expect(englishSearchTerms("someone")).toBe("someone")
    expect(englishSearchTerms("  ")).toBeNull()
  })
})

describe("relaxedEnglishSearchTerms", () => {
  it("leaves out each content word of a 3–6 word phrase in turn", () => {
    expect(relaxedEnglishSearchTerms("walk on thin ice")).toEqual(["thin ice", "walk ice", "walk thin"])
  })

  it("counts no pronoun, placeholder or function word as a phrase's word", () => {
    expect(relaxedEnglishSearchTerms("get on my nerves")).toEqual([])
    expect(relaxedEnglishSearchTerms("pull myself together")).toEqual([])
  })

  it("leaves short phrases and sentences alone", () => {
    expect(relaxedEnglishSearchTerms("thin ice")).toEqual([])
    expect(relaxedEnglishSearchTerms("the quick brown fox jumps over lazy dogs")).toEqual([])
  })
})
