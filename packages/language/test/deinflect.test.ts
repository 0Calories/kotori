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
    ["よかったら", "いい", ["conditional"]],
    ["書いちゃった", "書く", ["past", "completed"]],
    ["食べちゃった", "食べる", ["past", "completed"]],
    ["飲んじゃった", "飲む", ["past", "completed"]],
    ["行っちゃった", "行く", ["past", "completed"]],
    ["来ちゃった", "来る", ["past", "completed"]],
    ["しちゃった", "する", ["past", "completed"]],
    ["勉強しちゃった", "勉強", ["past", "completed", "suru"]],
    ["食べてしまった", "食べる", ["past", "completed", "te"]],
    ["食べさせられた", "食べる", ["past", "passive", "causative"]],
    ["食べさせられなかった", "食べる", ["past", "negative", "passive", "causative"]],
    ["書かせられた", "書く", ["past", "passive", "causative"]],
    ["書かされた", "書く", ["past", "passive", "causative"]],
    ["飲まされた", "飲む", ["past", "passive", "causative"]],
    ["食べれる", "食べる", ["potential"]],
    ["食べれなかった", "食べる", ["past", "negative", "potential"]],
    ["見れた", "見る", ["past", "potential"]],
    ["来れる", "来る", ["potential"]],
    ["これなかった", "くる", ["past", "negative", "potential"]],
    ["食べすぎちゃった", "食べる", ["past", "completed", "too-much"]],
    ["食べなきゃ", "食べる", ["conditional", "negative"]],
    ["行かなくちゃ", "行く", ["conditional", "negative"]],
    ["ググっちゃった", "ググる", ["past", "completed"]],
    ["バズってる", "バズる", ["progressive", "te"]],
    ["エモすぎた", "エモい", ["past", "too-much"]]
  ])("%s -> %s", (word, term, reasons) => {
    expect(find(word, term)?.reasons).toEqual(reasons)
  })

  it("tags ra-nuki potentials and 来る contractions with the right verb class", () => {
    expect(deinflect("食べれる")).toContainEqual({ term: "食べる", type: "v1", reasons: ["potential"] })
    expect(deinflect("食べれなかった")).toContainEqual({
      term: "食べる",
      type: "v1",
      reasons: ["past", "negative", "potential"]
    })
    expect(deinflect("来れる")).toContainEqual({ term: "来る", type: "vk", reasons: ["potential"] })
    expect(deinflect("これなかった")).toContainEqual({
      term: "くる",
      type: "vk",
      reasons: ["past", "negative", "potential"]
    })
    expect(deinflect("来ちゃった")).toContainEqual({ term: "来る", type: "vk", reasons: ["past", "completed"] })
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

  it("reads Hepburn's tch as a doubled ch", () => {
    expect(romajiToKana("matcha")).toBe("まっちゃ")
    expect(romajiToKana("kotchi")).toBe("こっち")
    expect(romajiToKana("kocchi")).toBe("こっち")
    expect(romajiToKana("watch")).toBeNull()
  })
})
