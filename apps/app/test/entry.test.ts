import {
  CautionKind,
  type Entry,
  type EntryCaution,
  EntryId,
  type Label,
  LabelCode,
  type LabelSeverity,
  type Sense,
  SimilarDifference,
  type SimilarWord,
  type Source,
  type UsagePattern
} from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import {
  contributors,
  frequencyChip,
  hasKotoriContent,
  hasKotoriMarks,
  heroItems,
  labelItems,
  loanChip,
  onItsWay,
  loanLine,
  resultLabels,
  senseCautions,
  similarWords,
  wordCautions
} from "../src/lib/entry.ts"

const t = strings.en

/** The severities of the codes these tests use, as the API sends them (`LABEL_SEVERITY` in `@kotori/db`). */
const SEVERITY: Partial<Record<LabelCode, LabelSeverity>> = {
  vulg: "avoid",
  arch: "avoid",
  col: "warning",
  male: "warning",
  dated: "warning",
  form: "info",
  "en-US": "info",
  id: "quiet"
}

const label = (code: LabelCode, source: Source = "jmdict"): Label => ({ code, severity: SEVERITY[code]!, source })

const usagePattern = (text: string, source: Source = "jmdict"): UsagePattern => ({ text, source, about: null })

const caution = (id: number, sense: number | null, source: Source = "kotori"): EntryCaution => ({
  id,
  kind: "rude_upward",
  text: `caution ${id}`,
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
  fields: [],
  info: [],
  appliesTo: [],
  related: [],
  antonyms: [],
  origins: [],
  examples: [],
  labels: [],
  usagePatterns: [],
  similarWords: [],
  ...overrides
})

/** A dictionary-only Japanese word: no labels, frequency, loan or cautions. */
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: EntryId.make(1),
  language: "ja",
  source: "jmdict",
  review: "approved",
  headword: "食べる",
  reading: "たべる",
  common: false,
  romaji: "taberu",
  usuallyKana: false,
  labels: [],
  frequency: null,
  loanLink: null,
  cautions: [],
  forms: [],
  senses: [sense(0)],
  audioUrl: null,
  audio: [],
  enrichment: { examples: "ready", audio: "ready" },
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
    assert.equal(casual?.severity, "warning")
    assert.equal(casual?.kotori, true)
    assert.equal(casual?.help, `${t.labels.help.col} ✦ ${t.labels.kotori}`)
  })

  it("name and explain every label code, caution kind and difference in both languages", () => {
    for (const ui of [strings.en, strings.ja]) {
      for (const code of LabelCode.literals) {
        assert.ok(ui.labels.name[code].length > 0, code)
        assert.ok(ui.labels.help[code].length > 0, code)
      }
      for (const kind of CautionKind.literals) assert.ok(ui.caution[kind].length > 0, kind)
      for (const difference of SimilarDifference.literals) assert.ok(ui.entry.difference[difference].length > 0)
    }
    // The Japanese interface has its own words, not the English ones copied over.
    assert.notEqual(strings.ja.labels.help.col, strings.en.labels.help.col)
    assert.notEqual(strings.ja.labels.name.uncountable, strings.en.labels.name.uncountable)
  })
})

describe("search result labels", () => {
  it("show at most two, loudest first, and never a grammar fact", () => {
    const codes = (labels: ReadonlyArray<Label>) => labels.map((own) => own.code)
    assert.deepStrictEqual(codes(resultLabels([label("id"), label("form"), label("col"), label("vulg")])), [
      "vulg",
      "col"
    ])
    assert.deepStrictEqual(codes(resultLabels([label("id"), label("en-US")])), ["en-US"])
    assert.deepStrictEqual(resultLabels([label("id")]), [])
  })
})

describe("frequency chip", () => {
  it("reassures on common words and says nothing for the middle", () => {
    assert.equal(frequencyChip(t, entry({ common: true }))?.key, "common")
    assert.equal(
      frequencyChip(t, entry({ frequency: { everyday: true, spokenCount: null, score: null } }))?.key,
      "common"
    )
    assert.equal(frequencyChip(t, entry({ frequency: { everyday: false, spokenCount: 40, score: 3 } })), null)
    assert.equal(frequencyChip(t, entry()), null)
  })

  it("flags words natives seldom say, even common-listed ones", () => {
    const rare = frequencyChip(t, entry({ common: true, frequency: { everyday: false, spokenCount: null, score: 2 } }))
    assert.equal(rare?.key, "rare")
    assert.equal(rare?.severity, "warning")
    assert.equal(frequencyChip(t, entry({ labels: [label("arch")] }))?.key, "rare")
    // Dated words are still heard; their label says the rest.
    assert.equal(frequencyChip(t, entry({ labels: [label("dated")] })), null)
  })
})

describe("loan link", () => {
  const link = (meaning: "true_loanword" | "wasei_eigo" | null) => ({
    katakana: "アドバイス",
    katakanaEntryId: EntryId.make(2),
    english: "advice",
    englishEntryId: EntryId.make(3),
    meaning,
    source: "kotori" as const,
    meaningSource: meaning === null ? null : ("kotori" as const)
  })

  it("reads as an origin line on the katakana word", () => {
    assert.equal(loanLine(t, entry({ loanLink: link(null) })), t.entry.loanFrom("advice"))
    assert.equal(loanLine(t, entry({ loanLink: link("true_loanword") })), t.entry.loanFromSame("advice"))
    assert.equal(loanLine(t, entry({ loanLink: link("wasei_eigo") })), t.entry.loanFromDiverged("advice"))
    assert.equal(loanLine(t, entry({ language: "en", loanLink: link("true_loanword") })), null)
    assert.equal(loanChip(t, entry({ loanLink: link("true_loanword") })), null)
  })

  it("is a quiet chip on the English word only when it is a true loanword", () => {
    const english = (meaning: "true_loanword" | "wasei_eigo" | null) =>
      entry({ language: "en", loanLink: link(meaning) })
    assert.equal(loanChip(t, english("true_loanword"))?.label, t.entry.loanSame("アドバイス"))
    // Kotori judged the meaning here, so the chip carries the mark and the page its legend.
    assert.equal(loanChip(t, english("true_loanword"))?.kotori, true)
    assert.equal(hasKotoriMarks(english("true_loanword")), true)
    assert.equal(loanChip(t, english("wasei_eigo")), null)
    assert.equal(loanChip(t, english(null)), null)

    // JMDict named the pair and Kotori judged it: the verdict still carries the mark.
    const named = entry({ language: "en", loanLink: { ...link("true_loanword"), source: "jmdict" } })
    assert.equal(loanChip(t, named)?.kotori, true)
    assert.equal(hasKotoriMarks(named), true)
    assert.deepStrictEqual(contributors(t, { ...named, source: "enwiktionary" }), ["Wiktionary", "JMDict", "Kotori"])
    const unjudged = entry({ language: "en", loanLink: { ...link(null), source: "jmdict" } })
    assert.equal(hasKotoriMarks(unjudged), false)
  })

  it("leads the hero's chips with frequency and loan, then the word's labels", () => {
    const chips = heroItems(
      t,
      entry({ language: "en", common: true, loanLink: link("true_loanword"), labels: [label("en-US")] })
    )
    assert.deepStrictEqual(
      chips.map((chip) => chip.key),
      ["common", "loan", "en-US"]
    )
  })
})

describe("cautions", () => {
  it("split into the word's and each sense's", () => {
    const cautions = [caution(1, null), caution(2, 1), caution(3, null)]
    assert.deepStrictEqual(
      wordCautions(cautions).map((p) => p.id),
      [1, 3]
    )
    assert.deepStrictEqual(
      senseCautions(cautions, 1).map((p) => p.id),
      [2]
    )
    assert.deepStrictEqual(senseCautions(cautions, 0), [])
  })
})

describe("Kotori's mark", () => {
  it("shows the legend only when a label, note or caution is Kotori's", () => {
    assert.equal(
      hasKotoriMarks(
        entry({ labels: [label("col")], senses: [sense(0, { usagePatterns: [usagePattern("as 〜ですが")] })] })
      ),
      false
    )
    assert.equal(hasKotoriMarks(entry({ senses: [sense(0), sense(1, { labels: [label("form", "kotori")] })] })), true)
    assert.equal(
      hasKotoriMarks(entry({ senses: [sense(0, { usagePatterns: [usagePattern("Say お疲れ様です", "kotori")] })] })),
      true
    )
    assert.equal(hasKotoriMarks(entry({ cautions: [caution(1, null)] })), true)
  })

  it("waits and polls only for enrichment that is on its way", () => {
    assert.deepStrictEqual((["ready", "unrequested", "queued", "unavailable"] as const).filter(onItsWay), ["queued"])
  })

  it("treats seeded sentences as the dictionary's, so the word still offers to ask Kotori", () => {
    assert.equal(hasKotoriContent(entry({ senses: [sense(0, { examples: [example(1, "tatoeba")] })] })), false)
    assert.equal(hasKotoriContent(entry({ senses: [sense(0, { examples: [example(1, "kotori")] })] })), true)
    assert.equal(hasKotoriContent(entry({ audioUrl: "/audio/1" })), true)
    assert.equal(hasKotoriContent(entry({ cautions: [caution(1, null)] })), true)
  })
})

describe("sources line", () => {
  it("names the primary source first, then each other contributor once", () => {
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
          source: "jmdict",
          meaningSource: null
        },
        cautions: [caution(1, null)],
        senses: [sense(0, { examples: [example(1, "tatoeba"), example(2, "kotori"), example(3, "tatoeba")] })]
      })
    )
    assert.deepStrictEqual(names, ["JMDict", "Tatoeba", "Kotori"])
    assert.deepStrictEqual(contributors(strings.ja, entry({ source: "enwiktionary", language: "en" })), [
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
