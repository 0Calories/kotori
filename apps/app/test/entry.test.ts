import {
  type Entry,
  EntryId,
  type Label,
  LabelCode,
  type LabelSeverity,
  type Pattern,
  PitfallKind,
  type Sense,
  SimilarDifference,
  type SimilarWord,
  type Source,
  type WordPitfall
} from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import {
  contributors,
  hasKotoriContent,
  hasKotoriMarks,
  heroItems,
  labelItems,
  loanChip,
  loanLine,
  saveDetails,
  sensePitfalls,
  similarWords,
  usageChip,
  wordPitfalls
} from "../src/lib/entry.ts"

const t = strings.en

/** The severities of the codes these tests use, as the API sends them (`LABEL_SEVERITY` in `@kotori/db`). */
const SEVERITY: Partial<Record<LabelCode, LabelSeverity>> = {
  vulg: "avoid",
  arch: "avoid",
  col: "caution",
  male: "caution",
  dated: "caution",
  form: "info",
  "en-US": "info",
  id: "quiet"
}

const label = (code: LabelCode, source: Source = "jmdict"): Label => ({ code, severity: SEVERITY[code]!, source })

const pattern = (text: string, source: Source = "jmdict"): Pattern => ({ text, source, about: null })

const pitfall = (id: number, sense: number | null, source: Source = "kotori"): WordPitfall => ({
  id,
  kind: "rude_upward",
  text: `pitfall ${id}`,
  sense,
  about: null,
  source
})

const similar = (entryId: number): SimilarWord => ({
  entryId: EntryId.make(entryId),
  headword: `word ${entryId}`,
  reading: "",
  meaning: "meaning",
  difference: "similar",
  via: "xref"
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
  nuance: null,
  note: null,
  noteJa: null,
  similar: [],
  examples: [],
  labels: [],
  patterns: [],
  similarWords: [],
  ...overrides
})

/** A dictionary-only Japanese word: no labels, evidence, loan or pitfalls. */
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: EntryId.make(1),
  language: "ja",
  dictionary: "jmdict",
  headword: "食べる",
  reading: "たべる",
  common: false,
  romaji: "taberu",
  usuallyKana: false,
  labels: [],
  evidence: null,
  loanLink: null,
  pitfalls: [],
  forms: [],
  senses: [sense(0)],
  audioUrl: null,
  audio: [],
  loan: null,
  enrichment: { nuance: "ready", examples: "ready", audio: "ready" },
  ...overrides
})

const example = (id: number, source: Source) => ({
  id,
  ja: "ご飯を食べる。",
  furigana: "ご飯を食べる。",
  en: "I eat rice.",
  formality: null,
  note: null,
  noteJa: null,
  source,
  audioUrl: null,
  translationAudioUrl: null
})

describe("label chips", () => {
  it("speak at the severity the vocabulary gives them, and Kotori's say where they came from", () => {
    const [vulgar, casual] = labelItems(t, [label("vulg"), label("col", "kotori")])
    assert.deepStrictEqual(vulgar, {
      key: "vulg",
      label: t.labels.name.vulg,
      help: t.labels.help.vulg,
      severity: "avoid",
      kotori: false
    })
    assert.equal(casual?.severity, "caution")
    assert.equal(casual?.kotori, true)
    assert.equal(casual?.help, `${t.labels.help.col} ✦ ${t.labels.kotori}`)
  })

  it("name and explain every label code, pitfall kind and difference in both languages", () => {
    for (const ui of [strings.en, strings.ja]) {
      for (const code of LabelCode.literals) {
        assert.ok(ui.labels.name[code].length > 0, code)
        assert.ok(ui.labels.help[code].length > 0, code)
      }
      for (const kind of PitfallKind.literals) assert.ok(ui.pitfall[kind].length > 0, kind)
      for (const difference of SimilarDifference.literals) assert.ok(ui.entry.difference[difference].length > 0)
    }
    // The Japanese interface has its own words, not the English ones copied over.
    assert.notEqual(strings.ja.labels.help.col, strings.en.labels.help.col)
    assert.notEqual(strings.ja.labels.name.uncountable, strings.en.labels.name.uncountable)
  })
})

describe("usage chip", () => {
  it("reassures on common words and says nothing for the middle", () => {
    assert.equal(usageChip(t, entry({ common: true }))?.key, "common")
    assert.equal(
      usageChip(t, entry({ evidence: { everyday: true, spokenCount: null, familiarity: null } }))?.key,
      "common"
    )
    assert.equal(usageChip(t, entry({ evidence: { everyday: false, spokenCount: 40, familiarity: 3 } })), null)
    assert.equal(usageChip(t, entry()), null)
  })

  it("flags words natives seldom say, even common-listed ones", () => {
    const rare = usageChip(t, entry({ common: true, evidence: { everyday: false, spokenCount: null, familiarity: 2 } }))
    assert.equal(rare?.key, "rare")
    assert.equal(rare?.severity, "caution")
    assert.equal(usageChip(t, entry({ labels: [label("arch")] }))?.key, "rare")
    // Dated words are still heard; their label says the rest.
    assert.equal(usageChip(t, entry({ labels: [label("dated")] })), null)
  })
})

describe("loan link", () => {
  const link = (meaning: "same" | "divergent" | null) => ({
    katakana: "アドバイス",
    katakanaEntryId: EntryId.make(2),
    english: "advice",
    englishEntryId: EntryId.make(3),
    meaning,
    source: "kotori" as const
  })

  it("reads as an origin line on the katakana word", () => {
    assert.equal(loanLine(t, entry({ loanLink: link(null) })), t.entry.loanFrom("advice"))
    assert.equal(loanLine(t, entry({ loanLink: link("same") })), t.entry.loanFromSame("advice"))
    assert.equal(loanLine(t, entry({ loanLink: link("divergent") })), t.entry.loanFromDiverged("advice"))
    assert.equal(loanLine(t, entry({ language: "en", loanLink: link("same") })), null)
    assert.equal(loanChip(t, entry({ loanLink: link("same") })), null)
  })

  it("is a quiet chip on the English word only when the meaning is the same", () => {
    const english = (meaning: "same" | "divergent" | null) => entry({ language: "en", loanLink: link(meaning) })
    assert.equal(loanChip(t, english("same"))?.label, t.entry.loanSame("アドバイス"))
    // Kotori judged the meaning here, so the chip carries the mark and the page its legend.
    assert.equal(loanChip(t, english("same"))?.kotori, true)
    assert.equal(hasKotoriMarks(english("same")), true)
    assert.equal(loanChip(t, english("divergent")), null)
    assert.equal(loanChip(t, english(null)), null)
  })

  it("leads the hero's chips with usage and loan, then the word's labels", () => {
    const chips = heroItems(
      t,
      entry({ language: "en", common: true, loanLink: link("same"), labels: [label("en-US")] })
    )
    assert.deepStrictEqual(
      chips.map((chip) => chip.key),
      ["common", "loan", "en-US"]
    )
  })
})

describe("pitfalls", () => {
  it("split into the word's and each sense's", () => {
    const pitfalls = [pitfall(1, null), pitfall(2, 1), pitfall(3, null)]
    assert.deepStrictEqual(
      wordPitfalls(pitfalls).map((p) => p.id),
      [1, 3]
    )
    assert.deepStrictEqual(
      sensePitfalls(pitfalls, 1).map((p) => p.id),
      [2]
    )
    assert.deepStrictEqual(sensePitfalls(pitfalls, 0), [])
  })
})

describe("Kotori's mark", () => {
  it("shows the legend only when a label, note or pitfall is Kotori's", () => {
    assert.equal(
      hasKotoriMarks(entry({ labels: [label("col")], senses: [sense(0, { patterns: [pattern("as 〜ですが")] })] })),
      false
    )
    assert.equal(hasKotoriMarks(entry({ senses: [sense(0), sense(1, { labels: [label("form", "kotori")] })] })), true)
    assert.equal(
      hasKotoriMarks(entry({ senses: [sense(0, { patterns: [pattern("Say お疲れ様です", "kotori")] })] })),
      true
    )
    assert.equal(hasKotoriMarks(entry({ pitfalls: [pitfall(1, null)] })), true)
  })

  it("treats seeded sentences as the dictionary's, so the word still offers to ask Kotori", () => {
    assert.equal(hasKotoriContent(entry({ senses: [sense(0, { examples: [example(1, "tatoeba")] })] })), false)
    assert.equal(hasKotoriContent(entry({ senses: [sense(0, { examples: [example(1, "kotori")] })] })), true)
    assert.equal(hasKotoriContent(entry({ audioUrl: "/audio/1" })), true)
    assert.equal(hasKotoriContent(entry({ pitfalls: [pitfall(1, null)] })), true)
  })
})

describe("sources line", () => {
  it("names the dictionary first, then each other contributor once", () => {
    const names = contributors(
      t,
      entry({
        labels: [label("col")],
        loanLink: {
          katakana: "マンション",
          katakanaEntryId: EntryId.make(1),
          english: "mansion",
          englishEntryId: null,
          meaning: null,
          source: "jmdict"
        },
        pitfalls: [pitfall(1, null)],
        senses: [sense(0, { examples: [example(1, "tatoeba"), example(2, "kotori"), example(3, "tatoeba")] })]
      })
    )
    assert.deepStrictEqual(names, ["JMDict", "Tatoeba", "Kotori"])
    assert.deepStrictEqual(contributors(strings.ja, entry({ dictionary: "enwiktionary", language: "en" })), [
      "ウィクショナリー"
    ])
  })
})

describe("similar words", () => {
  it("lists each word once, under the first sense it is close to", () => {
    const words = similarWords([
      sense(0, { similarWords: [similar(5), similar(6)] }),
      sense(1, { similarWords: [similar(7)] })
    ])
    assert.deepStrictEqual(
      words.map((word) => word.entryId),
      [5, 6, 7]
    )
  })
})

describe("saving a sense", () => {
  it("carries the register labels as the hint, and a pitfall before a usage note", () => {
    const word = entry({ labels: [label("col"), label("id")], pitfalls: [pitfall(1, null), pitfall(2, 1)] })
    const second = sense(1, { labels: [label("male")], patterns: [pattern("usu. as 〜ですが")] })
    assert.deepStrictEqual(saveDetails(t, word, second), {
      hint: `${t.labels.name.col} · ${t.labels.name.male}`,
      note: "pitfall 2"
    })
    assert.deepStrictEqual(saveDetails(t, entry(), sense(0, { patterns: [pattern("usu. in the negative")] })), {
      hint: null,
      note: "usu. in the negative"
    })
  })
})
