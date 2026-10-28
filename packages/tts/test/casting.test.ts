import type { Nuance } from "@kotori/domain"
import { describe, expect, it } from "vitest"
import { CAST, castVoices, headwordVoices, rank, tied, wanted } from "../src/index.ts"
import type { CastingInput, SenseSignals, SentenceSignals, Wanted } from "../src/index.ts"

/** The full cast as if every voice were already auditioned and cast. */
const FULL_CAST = CAST.map((voice) => ({ ...voice, providerId: voice.providerId ?? `fake-${voice.id}` }))

const sense = (overrides: Partial<SenseSignals> = {}): SenseSignals => ({
  misc: [],
  dialects: [],
  fields: [],
  ...overrides
})

const input = (
  sentence: Partial<SentenceSignals>,
  senseOverrides: Partial<SenseSignals> = {},
  nuance: Nuance | null = null
): CastingInput => ({
  sentence: { formality: "neutral", ...sentence },
  sense: sense(senseOverrides),
  nuance
})

const judgment = <T>(value: T, confidence = 0.9) => ({ value, confidence, source: "jev" as const })
const scale = <T>(value: T, confidence = 0.9) => ({ value, position: 0.5, confidence, source: "jev" as const })

const nuanceWith = (overrides: Partial<Nuance> = {}): Nuance => ({
  formality: scale("neutral"),
  medium: scale("both"),
  keigo: judgment("none"),
  gender: judgment("neutral"),
  age: judgment("any"),
  currency: judgment("current"),
  connotation: judgment("neutral"),
  cautions: { rudeToSuperiors: 0, stiffWithFriends: 0, slang: 0 },
  ...overrides
})

const topVoice = (want: Wanted, language: "ja" | "en" = "ja") => rank(want, FULL_CAST, language)[0]?.voice.id

describe("wanted", () => {
  it("takes the dialect from the sentence label", () => {
    expect(wanted(input({ dialect: "kansai" })).dialect).toBe("kansai")
  })

  it("falls back to JMDict dialect tags when the sentence has no label", () => {
    expect(wanted(input({}, { dialects: ["ksb"] })).dialect).toBe("kansai")
    expect(wanted(input({}, { dialects: ["osb"] })).dialect).toBe("kansai")
    expect(wanted(input({}, { dialects: ["thb"] })).dialect).toBe("tohoku")
  })

  it("prefers the sentence dialect over the sense tag", () => {
    expect(wanted(input({ dialect: "kansai" }, { dialects: ["thb"] })).dialect).toBe("kansai")
  })

  it("leaves unknown dialect labels as standard", () => {
    expect(wanted(input({ dialect: "nagoya" })).dialect).toBeNull()
  })

  it("pins gender from the fem/male misc tags", () => {
    expect(wanted(input({}, { misc: ["fem"] })).gender).toBe("feminine")
    expect(wanted(input({}, { misc: ["male"] })).gender).toBe("masculine")
  })

  it("prefers the sentence speaker over misc and nuance", () => {
    const got = wanted(input({ speakerGender: "masculine" }, { misc: ["fem"] }))
    expect(got.gender).toBe("masculine")
  })

  it("uses nuance gender only above the confidence floor", () => {
    expect(wanted(input({}, {}, nuanceWith({ gender: judgment("feminine", 0.9) }))).gender).toBe("feminine")
    expect(wanted(input({}, {}, nuanceWith({ gender: judgment("feminine", 0.4) }))).gender).toBeNull()
  })

  it("maps chn to a child speaker", () => {
    expect(wanted(input({}, { misc: ["chn"] })).age).toBe("child")
  })

  it("treats a formal sentence of a written or field-tagged word as an announcement", () => {
    expect(wanted(input({ formality: "formal" }, { fields: ["law"] })).medium).toBe("announcement")
    expect(wanted(input({ formality: "formal" }, {}, nuanceWith({ medium: scale("written") }))).medium).toBe(
      "announcement"
    )
    expect(wanted(input({ formality: "polite" }, { fields: ["law"] })).medium).toBeNull()
  })

  it("flags slang from formality, misc or nuance cautions", () => {
    expect(wanted(input({ formality: "vulgar" })).slang).toBe(true)
    expect(wanted(input({}, { misc: ["sl"] })).slang).toBe(true)
    expect(
      wanted(input({}, {}, nuanceWith({ cautions: { rudeToSuperiors: 0, stiffWithFriends: 0, slang: 0.8 } }))).slang
    ).toBe(true)
    expect(wanted(input({})).slang).toBe(false)
  })

  it("flags archaic from misc or nuance currency", () => {
    expect(wanted(input({}, { misc: ["arch"] })).archaic).toBe(true)
    expect(wanted(input({}, {}, nuanceWith({ currency: judgment("dated", 0.8) }))).archaic).toBe(true)
    expect(wanted(input({})).archaic).toBe(false)
  })
})

describe("rank", () => {
  it("hard-filters on dialect: only the Kansai voice may read a Kansai sentence", () => {
    const ranked = rank(wanted(input({ dialect: "kansai", formality: "casual" })), FULL_CAST, "ja")
    expect(ranked.map(({ voice }) => voice.id)).toEqual(["ja-kansai-m"])
  })

  it("never casts a dialect voice for a standard sentence", () => {
    const ranked = rank(wanted(input({ formality: "casual" })), FULL_CAST, "ja")
    expect(ranked.map(({ voice }) => voice.id)).not.toContain("ja-kansai-m")
  })

  it("the dialect filter beats soft signals: a formal Kansai line still goes Kansai", () => {
    const want = wanted(input({ dialect: "kansai", formality: "formal", medium: "announcement" }))
    expect(topVoice(want)).toBe("ja-kansai-m")
  })

  it("picks the announcer for a formal announcement", () => {
    expect(topVoice(wanted(input({ formality: "formal", medium: "announcement" })))).toBe("ja-announcer")
    expect(topVoice(wanted(input({ formality: "formal", medium: "announcement" })), "en")).toBe("en-announcer")
  })

  it("picks a casual young voice for vulgar banter, honouring the speaker's gender", () => {
    expect(topVoice(wanted(input({ formality: "vulgar", speakerGender: "masculine", speakerAge: "youth" })))).toBe(
      "ja-casual-m"
    )
    expect(topVoice(wanted(input({ formality: "vulgar", speakerGender: "feminine", speakerAge: "youth" })))).toBe(
      "ja-casual-f"
    )
  })

  it("picks the elder narrator for an archaic proverb", () => {
    const want = wanted(input({ formality: "neutral", medium: "narration" }, { misc: ["arch"] }))
    expect(topVoice(want)).toBe("ja-elder-m")
  })

  it("matches feminine misc words to feminine voices", () => {
    const ranked = rank(wanted(input({ formality: "casual" }, { misc: ["fem"] })), FULL_CAST, "ja")
    expect(ranked[0]!.voice.tags.gender).toBe("feminine")
  })

  it("relaxes the register filter rather than return nobody", () => {
    // No Kansai voice lists "formal", but the sentence is Kansai: the filter must relax.
    const ranked = rank(wanted(input({ dialect: "kansai", formality: "formal" })), FULL_CAST, "ja")
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.voice.id).toBe("ja-kansai-m")
  })

  it("ranks both languages from one Wanted onto matching speakers", () => {
    const want = wanted(input({ formality: "casual", speakerGender: "masculine", speakerAge: "youth" }))
    expect(topVoice(want, "ja")).toBe("ja-casual-m")
    expect(topVoice(want, "en")).toBe("en-casual-m")
  })

  it("only considers cast voices", () => {
    // In the real cast only Kyoko and Sarah have provider ids yet.
    const ranked = rank(wanted(input({ formality: "casual" })), CAST, "ja")
    expect(ranked.map(({ voice }) => voice.id)).toEqual(["ja-kyoko"])
  })

  it("prefers a voice that lists the register over one let in by the relaxed filter", () => {
    const want = wanted(input({ formality: "polite" }))
    const ranked = rank(want, FULL_CAST, "ja")
    expect(ranked[0]!.voice.tags.formality).toContain("polite")
  })
})

describe("tied", () => {
  it("returns the voices within the tie window of the top", () => {
    const want = wanted(input({ formality: "casual" }))
    const ranked = rank(want, FULL_CAST, "ja")
    const ties = tied(ranked)
    expect(ties.length).toBeGreaterThan(1)
    for (const { score } of ties) expect(ranked[0]!.score - score).toBeLessThanOrEqual(1)
  })

  it("returns one voice when scoring is decisive", () => {
    const want = wanted(input({ dialect: "kansai", formality: "casual" }))
    expect(tied(rank(want, FULL_CAST, "ja"))).toHaveLength(1)
  })

  it("is empty for an empty ranking", () => {
    expect(tied([])).toHaveLength(0)
  })
})

describe("cast helpers", () => {
  it("castVoices returns only cast voices of the language", () => {
    expect(castVoices("ja").map((voice) => voice.id)).toEqual(["ja-kyoko"])
    expect(castVoices("ja", FULL_CAST).length).toBeGreaterThan(1)
  })

  it("headwordVoices returns only headword-tagged cast voices", () => {
    for (const voice of headwordVoices("ja", FULL_CAST)) expect(voice.tags.headword).toBe(true)
    expect(headwordVoices("ja", FULL_CAST).map((voice) => voice.id)).toContain("ja-kyoko")
  })

  it("every cast voice has at most one tag per single-valued dimension and a description for Jev", () => {
    for (const voice of CAST) {
      expect(voice.description.length).toBeGreaterThan(20)
      expect(voice.tags.formality.length).toBeGreaterThan(0)
      expect(voice.id.startsWith(`${voice.language}-`)).toBe(true)
    }
  })
})
