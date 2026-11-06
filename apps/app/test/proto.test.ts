import { furiganaToText } from "@kotori/language"
import { describe, expect, it } from "vitest"
import { derivedDifference, stringsFor } from "../src/proto/display.ts"
import { byId, entries } from "../src/proto/mock.ts"

// The prototype's mock entries must be internally consistent, or the page misleads the review.

describe("prototype mock data", () => {
  it("has unique ids and resolvable references", () => {
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length)
    for (const entry of entries) {
      for (const pitfall of entry.pitfalls) {
        if (pitfall.about !== undefined)
          expect(byId.has(pitfall.about), `${entry.headword}: ${pitfall.about}`).toBe(true)
        if (pitfall.sense !== null)
          expect(entry.senses[pitfall.sense], `${entry.headword}: sense ${pitfall.sense}`).toBeDefined()
      }
      for (const sense of entry.senses) {
        for (const id of [...sense.similar, ...sense.antonyms])
          expect(byId.has(id), `${entry.headword}: ${id}`).toBe(true)
        for (const pattern of sense.patterns) {
          if (pattern.about !== undefined)
            expect(byId.has(pattern.about), `${entry.headword}: ${pattern.about}`).toBe(true)
        }
      }
      if (entry.loan?.englishEntryId != null) expect(byId.has(entry.loan.englishEntryId)).toBe(true)
      if (entry.loan?.katakanaEntryId != null) expect(byId.has(entry.loan.katakanaEntryId)).toBe(true)
      // The loan link is one fact: the entry is one of its two ends.
      if (entry.loan !== null) expect([entry.loan.katakana, entry.loan.english]).toContain(entry.headword)
    }
  })

  it("keeps furigana and plain sentences in step", () => {
    for (const entry of entries) {
      for (const sense of entry.senses) {
        for (const example of sense.examples) {
          expect(furiganaToText(example.furigana), `${entry.headword}: ${example.id}`).toBe(example.ja)
          expect(new Set(sense.examples.map((e) => e.id)).size).toBe(sense.examples.length)
        }
      }
    }
  })

  it("keeps labels and pitfalls on the headword's side of the model", () => {
    for (const entry of entries) {
      // No inference overwrites a dictionary fact: a Kotori label never sits beside the same code from the dictionary.
      for (const sense of entry.senses) {
        const codes = sense.labels.map((label) => label.code)
        expect(new Set(codes).size, `${entry.headword}: duplicate label`).toBe(codes.length)
      }
      expect(entry.pitfalls.length, `${entry.headword}: too many pitfalls`).toBeLessThanOrEqual(3)
      expect(entry.senses.length).toBeGreaterThan(0)
    }
  })

  it("derives similar-word differences from labels", () => {
    const t = stringsFor("ja")
    const taberu = byId.get(1358280)!.senses[0]!
    const kuu = byId.get(1269130)!.senses[0]!
    const meshiagaru = byId.get(1594790)!.senses[0]!
    expect(derivedDifference(t, taberu.labels, kuu.labels)).toBe(t.difference.casual)
    expect(derivedDifference(t, taberu.labels, meshiagaru.labels)).toBe(t.difference.respectful)
    expect(derivedDifference(t, kuu.labels, taberu.labels)).toBe(t.difference.formal)
  })
})
