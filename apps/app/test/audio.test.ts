import { assert, describe, it } from "vitest"
import { spokenExample, spokenHeadword } from "../src/lib/audio.ts"

describe("what an entry page speaks when no clip is stored yet", () => {
  it("reads a Japanese headword from its kana, including when the kanji is ambiguous", () => {
    assert.strictEqual(spokenHeadword({ language: "ja", headword: "爆睡", reading: "ばくすい" }), "ばくすい")
    assert.strictEqual(spokenHeadword({ language: "ja", headword: "生", reading: "なま" }), "なま")
    assert.strictEqual(spokenHeadword({ language: "ja", headword: "こんにちは", reading: "" }), "こんにちは")
  })

  it("reads an English headword as written, not from the IPA stored in the reading", () => {
    assert.strictEqual(spokenHeadword({ language: "en", headword: "flat", reading: "/flæt/" }), "flat")
  })

  it("reads an example in the language being learned", () => {
    const example = { ja: "昨日は爆睡した。", en: "I slept like a log yesterday." }
    assert.strictEqual(spokenExample(example, "ja"), "昨日は爆睡した。")
    assert.strictEqual(spokenExample(example, "en"), "I slept like a log yesterday.")
  })
})
