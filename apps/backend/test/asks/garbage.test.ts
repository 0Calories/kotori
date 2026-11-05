import type { Language } from "@kotori/contracts"
import { normalizeAsk } from "@kotori/language"
import { describe, expect, it } from "vitest"
import { turnAway } from "../../src/features/asks/garbage.ts"

/** Stage zero as `Asks.ask` runs it: on the normalized query. */
const asked = (query: string, language: Language) => turnAway(normalizeAsk(query, language), language)

describe("turnAway", () => {
  it("lets words, slang, interjections, abbreviations and misspellings through", () => {
    for (const query of [
      "bussin",
      "rizz",
      "a stone's throw away",
      "it be like it be",
      "brb",
      "tbh",
      "pfft",
      "definately",
      "strengths",
      "rhythm",
      "yesss",
      "bruhhh",
      "sksk",
      // Real words and interjections an older, stricter set of rules turned away.
      "catchphrase",
      "sightscreen",
      "watchstrap",
      "weltschmerz",
      "latchstring",
      "borschts",
      "hmmmm",
      "shhhh",
      "brrrr",
      "mmhmm",
      "tsktsk",
      "nooooo",
      "sooooo",
      "yessssss",
      "hmmmmm"
    ]) {
      expect(asked(query, "en"), query).toBeNull()
    }
    for (const query of ["それな", "蛙化現象", "sorena", "ぴえん", "kawaii", "matcha", "kotchi"]) {
      expect(asked(query, "ja"), query).toBeNull()
    }
  })

  it("turns away a key held down and a run along the keyboard; Jev's garbage route has the rest of the mash", () => {
    expect(asked("aaaaa", "en")).toBe("repetition")
    expect(asked("ｱｱｱｱｱｱ", "ja")).toBe("repetition")
    expect(asked("asdfg", "en")).toBe("keyboard")
    for (const mash of ["xqzvy", "fjdkslfjdk", "asdkjhqwe"]) expect(asked(mash, "en"), mash).toBeNull()
  })

  it("turns away the learner's own language either way round, and what isn't a query at all", () => {
    expect(asked("食べる", "en")).toBe("wrong_language")
    expect(asked("umbrella", "ja")).toBe("wrong_language")
    expect(asked("qwertyuiop", "ja")).toBe("wrong_language")
    expect(asked("12345", "ja")).toBe("not_askable")
    expect(asked("a<b>c", "en")).toBe("not_askable")
    expect(asked("one two three four five six seven eight nine", "en")).toBe("not_askable")
  })
})
