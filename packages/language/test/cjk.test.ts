import { describe, expect, it } from "vitest"
import { cjkSearchTokens } from "../src/index.ts"

describe("cjkSearchTokens", () => {
  it("extracts kanji unigrams for single-character kanji words", () => {
    expect(cjkSearchTokens("猫")).toEqual(["猫"])
    expect(cjkSearchTokens("禿")).toEqual(["禿"])
  })

  it("extracts overlapping bigrams and kanji unigrams for 2+ character kanji and mixed words", () => {
    expect(cjkSearchTokens("日本")).toEqual(["日本", "日", "本"])
    expect(cjkSearchTokens("禿鷹")).toEqual(["禿鷹", "禿", "鷹"])
    expect(cjkSearchTokens("日本語")).toEqual(["日本", "本語", "日", "本", "語"])
    expect(cjkSearchTokens("食べ放題")).toEqual(["食べ", "べ放", "放題", "食", "放", "題"])
    expect(cjkSearchTokens("気まずい思いをした")).toEqual([
      "気ま",
      "まず",
      "ずい",
      "い思",
      "思い",
      "いを",
      "をし",
      "した",
      "気",
      "思"
    ])
  })

  it("preserves hiragana vs katakana distinction in bigrams and omits single-character kana unigrams", () => {
    expect(cjkSearchTokens("ハゲタカ")).toEqual(["ハゲ", "ゲタ", "タカ"])
    expect(cjkSearchTokens("はげたか")).toEqual(["はげ", "げた", "たか"])
    expect(cjkSearchTokens("ハゲ")).toEqual(["ハゲ"])
    expect(cjkSearchTokens("の")).toEqual([])
  })

  it("normalizes NFKC, splits across non-Japanese boundaries, and deduplicates", () => {
    expect(cjkSearchTokens("ﾊｹﾞ")).toEqual(["ハゲ"])
    expect(cjkSearchTokens("食べる (a meal)")).toEqual(["食べ", "べる", "食"])
    expect(cjkSearchTokens("人人")).toEqual(["人人", "人"])
    expect(cjkSearchTokens("hello world")).toEqual([])
    expect(cjkSearchTokens("")).toEqual([])
  })
})
