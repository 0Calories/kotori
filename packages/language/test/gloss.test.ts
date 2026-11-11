import { describe, expect, it } from "vitest"
import { type GlossedEntry, loanCandidatesIn, normalizeGloss, normalizeJapaneseGloss } from "../src/index.ts"

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

describe("loanCandidatesIn", () => {
  const entry = (
    id: number,
    headword: string,
    priority: number,
    senses: Array<{ glosses: Array<string>; origins?: Array<{ language: string; word: string | null }> }>,
    common = true
  ): GlossedEntry => ({
    id,
    language: "ja",
    headword,
    common,
    priority,
    senses: senses.map(({ glosses, origins }) => ({
      glosses: glosses.map((text) => ({ text })),
      origins: origins ?? []
    }))
  })

  const entries: Array<GlossedEntry> = [
    entry(9100001, "スタイル", 60, [{ glosses: ["(one's) figure", "physique"] }, { glosses: ["style"] }]),
    entry(9100002, "タイプ", 40, [{ glosses: ["type", "kind", "style"] }]),
    entry(9100003, "マンション", 60, [
      { glosses: ["condominium", "apartment building"], origins: [{ language: "eng", word: "mansion" }] }
    ]),
    entry(9100005, "タレント", 60, [{ glosses: ["talent", "skill"], origins: [{ language: "eng", word: "talent" }] }]),
    entry(9100006, "ウォーク", 0, [{ glosses: ["walk"] }], false),
    entry(9100007, "様式", 90, [{ glosses: ["style", "form"] }]),
    entry(9100008, "ズボン", 60, [{ glosses: ["trousers"], origins: [{ language: "fre", word: "jupon" }] }])
  ]

  const byWord = (words: Array<string>, limit: number) => {
    const found = loanCandidatesIn(entries, words, limit)
    return Object.fromEntries(
      words
        .map(normalizeGloss)
        .map((word) => [word, found.filter((c) => c.word === word).map((c) => `${c.entryId}:${c.by}`)])
    )
  }

  it("finds common katakana loans, most frequent first", () => {
    expect(byWord(["style", "mansion", "talent", "to walk", "jupon"], 3)).toEqual({
      // 様式 is kanji, so not a loan; the more frequent loan comes first.
      style: ["9100001:gloss", "9100002:gloss"],
      // Only JMDict's lsource ties マンション to "mansion".
      mansion: ["9100003:source"],
      // An origin beats a gloss as the reason.
      talent: ["9100005:source"],
      // Uncommon words aren't everyday loans.
      walk: [],
      // Non-English origins aren't English loan candidates.
      jupon: []
    })
  })

  it("keeps at most `limit` candidates per word", () => {
    expect(byWord(["style"], 1).style).toEqual(["9100001:gloss"])
  })
})
