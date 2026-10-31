import type { Medium, Nuance, Sense } from "@kotori/domain"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import { dictionaryTags, registerDisplay, registers } from "../src/lib/nuance.ts"

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
    assert.deepStrictEqual(dictionaryTags(american), [{ code: "aviat", label: "aviation" }])
    // Too unsure to show, the judgment leaves the tag where it is.
    const unsure = { ...american, nuance: nuance({ variety: judged("american" as const, 0.3) }) }
    assert.deepStrictEqual(dictionaryTags(unsure), [{ code: "aviat", label: "aviation" }, usOnly])
    assert.deepStrictEqual(dictionaryTags({ ...american, nuance: null }), [
      { code: "aviat", label: "aviation" },
      usOnly
    ])
  })

  it("leaves out a tag whose register the page shows, by its code in either language", () => {
    const fromTag = <A>(value: A) => ({ value, confidence: 1, source: "jmdict" as const })
    // ご苦労様: pol makes it polite 丁寧語, shown as "Polite (丁寧語)" whatever the tag's label says.
    const pol = { code: "pol", label: "polite (teineigo) language" }
    const gokurousama = sense(0, {
      misc: [pol],
      nuance: nuance({
        formality: { ...fromTag("polite" as const), position: 0.75 },
        keigo: fromTag("teineigo" as const)
      })
    })
    assert.deepStrictEqual(dictionaryTags(gokurousama), [])
    // col makes a sense casual and spoken: 口語 would repeat 「カジュアル · 話し言葉」.
    const col = { code: "col", label: "colloquial" }
    const casual = nuance({
      formality: { ...fromTag("casual" as const), position: 0.25 },
      medium: { ...fromTag("spoken" as const), position: 0 }
    })
    assert.deepStrictEqual(dictionaryTags(sense(0, { misc: [col], nuance: casual })), [])
    // A split register shows no scale, and a tag a stronger one overrode says something new.
    const split = { ...casual, registerShape: fromTag("split" as const) }
    assert.deepStrictEqual(dictionaryTags(sense(0, { misc: [col], nuance: split })), [col])
    // With hon as well, hon decides: formal 尊敬語 is shown, and pol's 丁寧語 isn't, so pol stays.
    const honorific = nuance({
      formality: { ...fromTag("formal" as const), position: 1 },
      keigo: fromTag("sonkeigo" as const)
    })
    const both = sense(0, { misc: [{ code: "hon", label: "honorific" }, pol], nuance: honorific })
    assert.deepStrictEqual(dictionaryTags(both), [pol])
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

  it("says the register in one line for every word, with sliders only where they fit", () => {
    // crap: crude and spoken, both at a scale's end, read as a line like any other word's.
    const crap = nuance({
      formality: { ...judged("vulgar" as const), position: 0 },
      medium: { ...judged("spoken" as const), position: 0 }
    })
    assert.deepStrictEqual(registerDisplay(t, crap), { line: ["乱暴", "話し言葉"], rows: [] })
    // A fixed register has no slider either, and a split one says so instead of a label.
    const fixed = nuance({ registerShape: judged("fixed" as const) })
    assert.deepStrictEqual(registerDisplay(t, fixed), { line: ["普通", "話し言葉と書き言葉"], rows: [] })
    const split = nuance({ registerShape: judged("split" as const) })
    assert.deepStrictEqual(registerDisplay(t, split).line, [t.nuance.contextSplit])
    assert.strictEqual(registerDisplay(t, nuance()).rows.length, 2)
  })

  it("doesn't give a sense its own line for leaving out a scale it's unsure of", () => {
    // tension: sense 2 unsure of its formality would read 「話し言葉と書き言葉」 alone.
    const unsure = sense(1, { nuance: nuance({ formality: { ...judged("neutral" as const, 0.25), position: 0.5 } }) })
    const tension = [sense(0), unsure]
    assert.deepStrictEqual(tension.map(registers(t, tension).ownLine), [false, false])
  })
})
