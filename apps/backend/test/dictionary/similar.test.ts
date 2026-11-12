import type { Label, LabelCode } from "@kotori/contracts"
import { labelSeverity } from "@kotori/db"
import { describe, expect, it } from "vitest"
import { type Candidate, differenceOf, pickCandidates, senseLabels } from "../../src/features/dictionary/similar.ts"

const label = (code: LabelCode, source: Label["source"] = "jmdict"): Label => ({
  code,
  severity: labelSeverity(code),
  source
})

describe("senseLabels", () => {
  it("states as the word's only the labels every sense carries, and each sense what it has beyond them", () => {
    const codes = (labels: ReadonlyArray<{ readonly code: string }>) => labels.map((own) => own.code)
    const shared = senseLabels([[label("male")], [label("male"), label("col")]])
    expect(codes(shared.word)).toEqual(["male"])
    expect(shared.senses.map(codes)).toEqual([[], ["col"]])

    // One archaic sense of two doesn't make the word archaic.
    const split = senseLabels([[label("arch"), label("pol")], [label("pol")], []])
    expect(codes(split.word)).toEqual([])
    expect(split.senses.map(codes)).toEqual([["arch", "pol"], ["pol"], []])

    // A single sense speaks for the word.
    const single = senseLabels([[label("sl"), label("col")]])
    expect(codes(single.word)).toEqual(["sl", "col"])
    expect(single.senses).toEqual([[]])
  })

  it("keeps a label on its senses when they have it from different sources", () => {
    const mixed = senseLabels([[label("form")], [label("form", "kotori")]])
    expect(mixed.word).toEqual([])
    expect(mixed.senses.map((own) => own.map((one) => one.source))).toEqual([["jmdict"], ["kotori"]])
  })

  it("says nothing for a word with no senses", () => {
    expect(senseLabels([])).toEqual({ word: [], senses: [] })
  })
})

describe("differenceOf", () => {
  it.each([
    [[], ["hon"], "respectful"],
    [[], ["hum"], "humble"],
    [[], ["col"], "more_casual"],
    [[], ["vulg"], "more_casual"],
    [[], ["form"], "more_formal"],
    // An unmarked word beside a marked one is the plain word, not the opposite register.
    [["sl"], [], "plain"],
    [["pol"], [], "plain"],
    [["hon"], [], "plain"],
    // Still masculine, so not the plain word; dropping only the casual label says nothing more.
    [["col", "male"], ["male"], "similar"],
    // 食う to 食べる: the word without the gendered label is the plain one.
    [["male"], [], "plain"],
    // 食べる and 食う: JMDict marks 食う male, not casual.
    [[], ["male"], "masculine"],
    [["col"], ["col", "male"], "masculine"],
    [[], ["fem"], "feminine"],
    [["en-GB"], ["en-US"], "american"],
    [[], ["en-GB"], "british"],
    [[], ["dated"], "older"],
    [["col"], ["col"], "similar"],
    [[], [], "similar"],
    // Keigo outranks register: 召し上がる is the respectful form even beside a casual word.
    [["col"], ["hon"], "respectful"]
  ] as const)("%j against %j is %s", (own, other, expected) => {
    expect(differenceOf(own, other)).toBe(expected)
  })
})

describe("pickCandidates", () => {
  const gloss = (sense: number, entryId: number): Candidate => ({ sense, entryId, otherSense: 0, via: "gloss" })
  const xref = (sense: number, entryId: number): Candidate => ({ sense, entryId, otherSense: null, via: "xref" })

  it("lists cross-references first, each word once under its first sense, never the entry itself", () => {
    const picked = pickCandidates(1, [gloss(0, 2), gloss(0, 1), xref(0, 3), gloss(1, 2), gloss(1, 4)], 4)
    expect(picked.map((candidate) => [candidate.sense, candidate.entryId, candidate.via])).toEqual([
      [0, 3, "xref"],
      [0, 2, "gloss"],
      [1, 4, "gloss"]
    ])
  })

  it("keeps at most the given number a sense", () => {
    expect(pickCandidates(1, [gloss(0, 2), gloss(0, 3), gloss(0, 4)], 2).map((c) => c.entryId)).toEqual([2, 3])
  })
})
