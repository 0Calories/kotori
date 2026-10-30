import type { Medium, Nuance, Sense } from "@kotori/domain"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import { dictionaryTags, registers } from "../src/lib/nuance.ts"

const t = strings.ja

const judged = <A>(value: A, confidence = 0.9) => ({ value, confidence, source: "jev" as const })

/** A sense's nuance: plain neutral wording, with whatever the test changes. */
const nuance = (overrides: Partial<Nuance> = {}): Nuance => ({
  formality: { ...judged("neutral" as const), position: 0.5 },
  medium: { ...judged("both" as const), position: 0.5 },
  keigo: judged("none" as const),
  gender: judged("neutral" as const),
  age: judged("any" as const),
  currency: judged("current" as const),
  connotation: judged("neutral" as const),
  cautions: { rudeToSuperiors: 0.1, stiffWithFriends: 0.1, slang: 0.1 },
  ...overrides
})

const sense = (index: number, overrides: Partial<Sense> = {}): Sense => ({
  index,
  glosses: [`meaning ${index}`],
  partsOfSpeech: [],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  appliesTo: [],
  related: [],
  antonyms: [],
  nuance: nuance(),
  note: null,
  noteJa: null,
  similar: [],
  examples: [],
  ...overrides
})

const usOnly = { code: "en-US", label: "US English" }

describe("the entry page's nuance", () => {
  it("doesn't repeat a dictionary tag that the judged nuance already shows", () => {
    // "elevator": the dictionary's en-US decides the variety, which the nuance card shows.
    const american = sense(0, {
      dialects: [usOnly],
      fields: [{ code: "aviat", label: "aviation" }],
      nuance: nuance({ variety: { value: "american", confidence: 1, source: "jmdict" } })
    })
    assert.deepStrictEqual(dictionaryTags(t, american), [{ code: "aviat", label: "aviation" }])
    // Too unsure to show, the judgment leaves the tag where it is.
    const unsure = { ...american, nuance: nuance({ variety: judged("american" as const, 0.3) }) }
    assert.deepStrictEqual(dictionaryTags(t, unsure), [{ code: "aviat", label: "aviation" }, usOnly])
    assert.deepStrictEqual(dictionaryTags(t, { ...american, nuance: null }), [
      { code: "aviat", label: "aviation" },
      usOnly
    ])
  })

  it("gives a sense its own register line only where it reads differently from the word's", () => {
    const written = (index: number) =>
      sense(index, { nuance: nuance({ medium: { ...judged<Medium>("written"), position: 1 } }) })
    // "style": three senses alike, and a fourth, behind "more", in written language.
    const style = [sense(0), sense(1), sense(2), written(3)]
    const { featured, ownLine } = registers(t, style)
    assert.strictEqual(featured, style[0])
    assert.deepStrictEqual(style.map(ownLine), [false, false, false, true])
    // A word whose first sense isn't judged is spoken for by the first that is.
    const later = [sense(0, { nuance: null }), written(1), sense(2)]
    assert.strictEqual(registers(t, later).featured, later[1])
    assert.deepStrictEqual(later.map(registers(t, later).ownLine), [false, false, true])
  })
})
