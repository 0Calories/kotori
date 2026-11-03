import { describe, expect, it } from "vitest"
import { furiganaToKana, furiganaToText, parseFurigana } from "../src/index.ts"

describe("furigana", () => {
  const sentence = "{毎朝|まいあさ}パンを{食|た}べる。"

  it("splits annotated and plain segments", () => {
    expect(parseFurigana(sentence)).toEqual([
      { text: "毎朝", reading: "まいあさ" },
      { text: "パンを", reading: null },
      { text: "食", reading: "た" },
      { text: "べる。", reading: null }
    ])
  })

  it("renders the written form and the reading", () => {
    expect(furiganaToText(sentence)).toBe("毎朝パンを食べる。")
    expect(furiganaToKana(sentence)).toBe("まいあさパンをたべる。")
  })

  it("passes through text without annotations", () => {
    expect(parseFurigana("こんにちは")).toEqual([{ text: "こんにちは", reading: null }])
    expect(parseFurigana("")).toEqual([])
  })
})
