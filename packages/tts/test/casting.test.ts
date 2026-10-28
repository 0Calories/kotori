import type { Language, Nuance } from "@kotori/domain"
import { describe, expect, it } from "vitest"
import { briefFor, CASTS, castVoices, ENGLISH_CAST, headwordVoices, JAPANESE_CAST, rank, tied } from "../src/index.ts"
import type { Casts, CastingBrief, CastingInput, SenseSignals, SentenceSignals } from "../src/index.ts"

/** The casts as if every voice were already auditioned and cast. */
const FULL_CASTS: Casts = {
  ja: JAPANESE_CAST.map((voice) => ({ ...voice, providerId: voice.providerId ?? `fake-${voice.id}` })),
  en: ENGLISH_CAST.map((voice) => ({ ...voice, providerId: voice.providerId ?? `fake-${voice.id}` }))
}

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

const topVoice = (brief: CastingBrief, language: Language = "ja") => rank(brief, language, FULL_CASTS)[0]?.voice.id

describe("briefFor", () => {
  it("takes the variety from the sentence label", () => {
    expect(briefFor(input({ variety: "kansai" })).variety).toBe("kansai")
  })

  it("falls back to JMDict dialect tags when the sentence has no label", () => {
    expect(briefFor(input({}, { dialects: ["ksb"] })).variety).toBe("kansai")
    expect(briefFor(input({}, { dialects: ["osb"] })).variety).toBe("kansai")
    expect(briefFor(input({}, { dialects: ["thb"] })).variety).toBe("tohoku")
  })

  it("prefers the sentence variety over the sense tag", () => {
    expect(briefFor(input({ variety: "kansai" }, { dialects: ["thb"] })).variety).toBe("kansai")
  })

  it("leaves unknown variety labels as the default", () => {
    expect(briefFor(input({ variety: "nagoya" })).variety).toBeNull()
  })

  it("pins gender from the fem/male misc tags", () => {
    expect(briefFor(input({}, { misc: ["fem"] })).gender).toBe("feminine")
    expect(briefFor(input({}, { misc: ["male"] })).gender).toBe("masculine")
  })

  it("prefers the sentence speaker over misc and nuance", () => {
    expect(briefFor(input({ speakerGender: "masculine" }, { misc: ["fem"] })).gender).toBe("masculine")
  })

  it("uses nuance gender only above the confidence floor", () => {
    expect(briefFor(input({}, {}, nuanceWith({ gender: judgment("feminine", 0.9) }))).gender).toBe("feminine")
    expect(briefFor(input({}, {}, nuanceWith({ gender: judgment("feminine", 0.4) }))).gender).toBeNull()
  })

  it("maps chn to a child speaker", () => {
    expect(briefFor(input({}, { misc: ["chn"] })).age).toBe("child")
  })

  it("treats a formal sentence of a written or field-tagged word as an announcement", () => {
    expect(briefFor(input({ formality: "formal" }, { fields: ["law"] })).medium).toBe("announcement")
    expect(briefFor(input({ formality: "formal" }, {}, nuanceWith({ medium: scale("written") }))).medium).toBe(
      "announcement"
    )
    expect(briefFor(input({ formality: "polite" }, { fields: ["law"] })).medium).toBeNull()
  })

  it("flags slang from formality, misc or nuance cautions", () => {
    expect(briefFor(input({ formality: "vulgar" })).slang).toBe(true)
    expect(briefFor(input({}, { misc: ["sl"] })).slang).toBe(true)
    const slangy = nuanceWith({ cautions: { rudeToSuperiors: 0, stiffWithFriends: 0, slang: 0.8 } })
    expect(briefFor(input({}, {}, slangy)).slang).toBe(true)
    expect(briefFor(input({})).slang).toBe(false)
  })

  it("flags archaic from misc or nuance currency", () => {
    expect(briefFor(input({}, { misc: ["arch"] })).archaic).toBe(true)
    expect(briefFor(input({}, {}, nuanceWith({ currency: judgment("dated", 0.8) }))).archaic).toBe(true)
    expect(briefFor(input({})).archaic).toBe(false)
  })
})

describe("rank", () => {
  it("hard-filters on variety: only the Kansai voice may read a Kansai sentence", () => {
    const ranked = rank(briefFor(input({ variety: "kansai", formality: "casual" })), "ja", FULL_CASTS)
    expect(ranked.map(({ voice }) => voice.id)).toEqual(["ja-kansai-m"])
  })

  it("never casts a regional voice for a default-variety sentence", () => {
    const ranked = rank(briefFor(input({ formality: "casual" })), "ja", FULL_CASTS)
    expect(ranked.map(({ voice }) => voice.id)).not.toContain("ja-kansai-m")
    const english = rank(briefFor(input({ formality: "neutral" })), "en", FULL_CASTS)
    expect(english.map(({ voice }) => voice.id)).not.toContain("en-british-m")
  })

  it("reaches a British voice only when the sentence asks for it", () => {
    expect(topVoice(briefFor(input({ variety: "british", formality: "neutral" })), "en")).toBe("en-british-m")
  })

  it("the variety filter beats soft signals: a formal Kansai line still goes Kansai", () => {
    const brief = briefFor(input({ variety: "kansai", formality: "formal", medium: "announcement" }))
    expect(topVoice(brief)).toBe("ja-kansai-m")
  })

  it("picks the announcer for a formal announcement", () => {
    expect(topVoice(briefFor(input({ formality: "formal", medium: "announcement" })))).toBe("ja-announcer")
    expect(topVoice(briefFor(input({ formality: "formal", medium: "announcement" })), "en")).toBe("en-announcer")
  })

  it("picks a casual young voice for vulgar banter, honouring the speaker's gender", () => {
    expect(topVoice(briefFor(input({ formality: "vulgar", speakerGender: "masculine", speakerAge: "youth" })))).toBe(
      "ja-casual-m"
    )
    expect(topVoice(briefFor(input({ formality: "vulgar", speakerGender: "feminine", speakerAge: "youth" })))).toBe(
      "ja-casual-f"
    )
  })

  it("picks the elder narrator for an archaic proverb", () => {
    const brief = briefFor(input({ formality: "neutral", medium: "narration" }, { misc: ["arch"] }))
    expect(topVoice(brief)).toBe("ja-elder-m")
  })

  it("matches feminine misc words to feminine voices", () => {
    const ranked = rank(briefFor(input({ formality: "casual" }, { misc: ["fem"] })), "ja", FULL_CASTS)
    expect(ranked[0]!.voice.tags.gender).toBe("feminine")
  })

  it("relaxes the register filter rather than return nobody", () => {
    // No Kansai voice lists "formal", but the sentence is Kansai: the filter must relax.
    const ranked = rank(briefFor(input({ variety: "kansai", formality: "formal" })), "ja", FULL_CASTS)
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.voice.id).toBe("ja-kansai-m")
  })

  it("casts both languages from one brief onto matching speakers", () => {
    const brief = briefFor(input({ formality: "casual", speakerGender: "masculine", speakerAge: "youth" }))
    expect(topVoice(brief, "ja")).toBe("ja-casual-m")
    expect(topVoice(brief, "en")).toBe("en-casual-m")
  })

  it("only considers cast voices", () => {
    // In the real casts only Kyoko and Sarah have provider ids yet.
    expect(rank(briefFor(input({ formality: "casual" })), "ja").map(({ voice }) => voice.id)).toEqual(["ja-kyoko"])
    expect(rank(briefFor(input({ formality: "casual" })), "en").map(({ voice }) => voice.id)).toEqual(["en-sarah"])
  })

  it("prefers a voice that lists the register over one let in by the relaxed filter", () => {
    const ranked = rank(briefFor(input({ formality: "polite" })), "ja", FULL_CASTS)
    expect(ranked[0]!.voice.tags.formality).toContain("polite")
  })
})

describe("tied", () => {
  it("returns the voices within the tie window of the top", () => {
    const ranked = rank(briefFor(input({ formality: "casual" })), "ja", FULL_CASTS)
    const ties = tied(ranked)
    expect(ties.length).toBeGreaterThan(1)
    for (const { score } of ties) expect(ranked[0]!.score - score).toBeLessThanOrEqual(1)
  })

  it("returns one voice when scoring is decisive", () => {
    expect(tied(rank(briefFor(input({ variety: "kansai", formality: "casual" })), "ja", FULL_CASTS))).toHaveLength(1)
  })

  it("is empty for an empty ranking", () => {
    expect(tied([])).toHaveLength(0)
  })
})

describe("casts", () => {
  it("castVoices returns only cast voices of the language", () => {
    expect(castVoices("ja").map((voice) => voice.id)).toEqual(["ja-kyoko"])
    expect(castVoices("en").map((voice) => voice.id)).toEqual(["en-sarah"])
    expect(castVoices("ja", FULL_CASTS).length).toBeGreaterThan(1)
  })

  it("headwordVoices returns only headword-tagged cast voices", () => {
    for (const voice of headwordVoices("ja", FULL_CASTS)) expect(voice.tags.headword).toBe(true)
    expect(headwordVoices("ja", FULL_CASTS).map((voice) => voice.id)).toContain("ja-kyoko")
  })

  it("every voice belongs to its cast's language and has a description for Jev", () => {
    for (const language of ["ja", "en"] as const) {
      for (const voice of CASTS[language]) {
        expect(voice.language).toBe(language)
        expect(voice.id.startsWith(`${language}-`)).toBe(true)
        expect(voice.description.length).toBeGreaterThan(20)
        expect(voice.tags.formality.length).toBeGreaterThan(0)
      }
    }
  })
})
