import { assert, describe, it } from "@effect/vitest"
import type { DraftOutput } from "@kotori/ai"
import { EntryId } from "@kotori/contracts"
import { checkDraft, draftToEntryRecord } from "../../src/features/asks/draft.ts"

type Output = NonNullable<DraftOutput["entry"]>

const output = (fields: Partial<Output> = {}): Output => ({
  headword: " bussin ",
  reading: "/ˈbʌsɪn/",
  spellings: ["bussin", "bussin'", "bussin'"],
  frequency: 4,
  senses: [
    { glosses: ["すごくおいしい", " "], pos: ["adj"], labels: ["sl", "trendy", "uk"], usagePatterns: ["若者言葉。"] },
    { glosses: [], pos: ["adj"], labels: [], usagePatterns: [] },
    { glosses: ["最高"], pos: [], labels: [], usagePatterns: [] }
  ],
  cautions: [],
  ...fields
})

describe("checkDraft", () => {
  it("trims and dedupes, drops the headword from its spellings, and keeps only vocabulary labels", () => {
    const draft = checkDraft(output(), "en")!
    assert.strictEqual(draft.headword, "bussin")
    assert.deepStrictEqual(draft.spellings, ["bussin'"])
    // "trendy" isn't a label, and "uk" is a spelling fact, not a usage label.
    assert.deepStrictEqual(draft.senses[0]?.labels, ["sl"])
    assert.deepStrictEqual(draft.senses[0]?.glosses, ["すごくおいしい"])
  })

  it("drops a sense with no gloss and moves cautions on later senses with it", () => {
    const draft = checkDraft(
      output({ cautions: [{ kind: "collocation", text: "On the third sense.", sense: 3, about: null }] }),
      "en"
    )!
    assert.deepStrictEqual(
      draft.senses.map((own) => own.glosses[0]),
      ["すごくおいしい", "最高"]
    )
    assert.deepStrictEqual(draft.cautions[0]?.sense, 1)
  })

  it("keeps out cautions that can't be right: wrong direction, unknown kind, missing sense, empty, past three", () => {
    const caution = (kind: string, sense: number | null = null, text = "Text.") => ({
      kind,
      text,
      sense,
      about: null
    })
    const draft = checkDraft(
      output({
        cautions: [
          // Wasei-eigo is a katakana loan misleading a Japanese speaker in English: never on a Japanese word.
          caution("wasei_eigo"),
          caution("made_up"),
          caution("set_phrase", 2),
          caution("set_phrase", 9),
          caution("set_phrase", null, "  "),
          caution("rude_upward"),
          caution("confusable", 1),
          caution("collocation"),
          caution("gendered_speech")
        ]
      }),
      "ja"
    )!
    assert.deepStrictEqual(
      draft.cautions.map((own) => [own.kind, own.sense]),
      [
        ["rude_upward", null],
        ["confusable", 0],
        ["collocation", null]
      ]
    )
    // "set_phrase" on sense 2: that sense had no gloss and is gone, so the caution goes too.
  })

  it("keeps frequency on its 1–5 scale, and has no draft when no sense has a gloss or no headword", () => {
    assert.strictEqual(checkDraft(output({ frequency: 9 }), "en")?.frequency, 5)
    assert.strictEqual(checkDraft(output({ frequency: 0 }), "en")?.frequency, 1)
    assert.isNull(checkDraft(output({ senses: [{ glosses: [" "], pos: [], labels: [], usagePatterns: [] }] }), "en"))
    assert.isNull(checkDraft(output({ headword: "  " }), "en"))
  })

  it("keeps only labels the word's language can carry", () => {
    const labelled = (labels: Array<string>) =>
      output({ senses: [{ glosses: ["意味"], pos: [], labels, usagePatterns: [] }] })
    assert.deepStrictEqual(
      checkDraft(labelled(["sl", "en-GB", "uncountable", "hon", "ksb"]), "en")?.senses[0]?.labels,
      ["sl", "en-GB", "uncountable"]
    )
    assert.deepStrictEqual(
      checkDraft(labelled(["sl", "en-GB", "uncountable", "hon", "ksb"]), "ja")?.senses[0]?.labels,
      ["sl", "hon", "ksb"]
    )
  })
})

describe("draftToEntryRecord", () => {
  it("maps a validated draft into an ImportEntry with labels, usage patterns, and frequency", () => {
    const draft = checkDraft(output(), "en")!
    const record = draftToEntryRecord(draft, "en", EntryId.make("kotori:bussin"))
    assert.strictEqual(record.source, "kotori")
    assert.deepStrictEqual(record.frequency, { everyday: false, spokenCount: null, score: 4 })
    assert.deepStrictEqual(record.senses[0]?.misc, ["sl"])
    assert.deepStrictEqual(record.senses[0]?.info, ["若者言葉。"])
    assert.deepStrictEqual(record.senses[0]?.pos, ["adj"])
    assert.deepStrictEqual(
      record.forms.map((form) => [form.kind, form.text]),
      [
        ["spelling", "bussin"],
        ["spelling", "bussin'"]
      ]
    )
  })
})
