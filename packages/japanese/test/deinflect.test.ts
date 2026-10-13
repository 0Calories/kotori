import { describe, expect, it } from "vitest"
import { deinflect, hasJapanese, matchesPartOfSpeech, romajiToKana } from "../src/index.ts"

const lemmas = (word: string) => deinflect(word).map((d) => `${d.term}:${d.type ?? "*"}`)
const find = (word: string, term: string) => deinflect(word).find((d) => d.term === term)

describe("deinflect", () => {
  it.each([
    ["食べなかった", "食べる", ["past", "negative"]],
    ["食べています", "食べる", ["polite", "progressive", "te"]],
    ["食べてる", "食べる", ["progressive", "te"]],
    ["食べたくない", "食べる", ["negative", "want"]],
    ["食べられる", "食べる", ["passive"]],
    ["書けます", "書く", ["polite", "potential"]],
    ["読んでいた", "読む", ["past", "progressive", "te"]],
    ["行きました", "行く", ["polite"]],
    ["行って", "行く", ["te"]],
    ["話さなければ", "話す", ["conditional", "negative"]],
    ["来ない", "来る", ["negative"]],
    ["こられる", "くる", ["potential"]],
    ["勉強しています", "勉強", ["polite", "progressive", "te", "suru"]],
    ["高くなかった", "高い", ["past", "negative"]],
    ["よかった", "いい", ["past"]],
    ["書いちゃった", "書く", ["past", "completed"]]
  ])("%s -> %s", (word, term, reasons) => {
    expect(find(word, term)?.reasons).toEqual(reasons)
  })

  it("always includes the query itself, untyped", () => {
    expect(deinflect("猫")[0]).toEqual({ term: "猫", type: null, reasons: [] })
  })

  it("does not invent progressive forms without a て-form", () => {
    expect(lemmas("見る")).not.toContain("見:iru")
    expect(find("見る", "見")).toBeUndefined()
  })
})

describe("matchesPartOfSpeech", () => {
  it("checks deinflected types against JMDict tags", () => {
    expect(matchesPartOfSpeech("v5", ["v5k", "vi"])).toBe(true)
    expect(matchesPartOfSpeech("v1", ["v5r"])).toBe(false)
    expect(matchesPartOfSpeech("vs-noun", ["n", "vs"])).toBe(true)
    expect(matchesPartOfSpeech(null, ["n"])).toBe(true)
  })
})

describe("script helpers", () => {
  it("detects Japanese text", () => {
    expect(hasJapanese("食べる")).toBe(true)
    expect(hasJapanese("カタカナ")).toBe(true)
    expect(hasJapanese("taberu")).toBe(false)
  })

  it("reads clean romaji as kana", () => {
    expect(romajiToKana("taberu")).toBe("たべる")
    expect(romajiToKana("Kirei")).toBe("きれい")
    expect(romajiToKana("hello world")).toBeNull()
    expect(romajiToKana("xyz")).toBeNull()
  })
})
