import type { Label, LabelCode } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"
import {
  choicesOf,
  layoutOf,
  moveChoice,
  noteMeaning,
  senseHint,
  showsSense,
  toggleChoice,
  withoutSense
} from "../src/lib/notes.ts"
import { savedWord } from "./notes.fixtures.ts"

const t = strings.en

const taberu = (shown: ReadonlyArray<boolean> = [true, true, true]) =>
  savedWord("taberu", {
    headword: "食べる",
    reading: "たべる",
    senses: [
      { glosses: ["to eat"], shown: shown[0] },
      { glosses: ["to live on", "to subsist on"], shown: shown[1] },
      { glosses: ["to bite"], shown: shown[2] }
    ]
  })

const order = (choices: ReturnType<typeof choicesOf>) =>
  choices.map((choice) => (choice.shown ? choice.index : `(${choice.index})`))

describe("a note's senses on the entry page", () => {
  it("counts a sense as saved only when the note shows it", () => {
    const note = taberu([true, false, true])
    assert.isTrue(showsSense(note, 0))
    assert.isFalse(showsSense(note, 1))
    assert.isFalse(showsSense(undefined, 0))
  })

  it("takes a meaning off the note, or the note itself when it's the last one shown", () => {
    assert.deepStrictEqual(withoutSense(taberu(), 1), { kind: "arrange", senses: [0, 2] })
    assert.deepStrictEqual(withoutSense(taberu([false, true, false]), 1), { kind: "remove" })
  })

  it("reads as the glosses of the senses it shows", () => {
    assert.strictEqual(noteMeaning(taberu([true, true, false])), "to eat / to live on; to subsist on")
  })
})

describe("choosing a note's meanings", () => {
  it("hides a sense into the dictionary's order and shows one again after the shown ones", () => {
    const hidden = toggleChoice(choicesOf(taberu()), 0)
    assert.deepStrictEqual(order(hidden), [1, 2, "(0)"])
    assert.deepStrictEqual(order(toggleChoice(hidden, 2)), [1, "(0)", "(2)"])
    assert.deepStrictEqual(order(toggleChoice(hidden, 0)), [1, 2, 0])
  })

  it("never hides the last shown sense", () => {
    const one = choicesOf(taberu([false, true, false]))
    assert.deepStrictEqual(toggleChoice(one, 1), one)
  })

  it("moves shown senses among themselves, never past a hidden one", () => {
    const choices = choicesOf(taberu([true, true, false]))
    assert.deepStrictEqual(order(moveChoice(choices, 1, -1)), [1, 0, "(2)"])
    assert.deepStrictEqual(moveChoice(choices, 1, 1), choices)
    assert.deepStrictEqual(moveChoice(choices, 0, -1), choices)
  })

  it("asks for every sense (null) when all are shown in the dictionary's order, else the shown ones in order", () => {
    assert.strictEqual(layoutOf(choicesOf(taberu())), null)
    assert.deepStrictEqual(layoutOf(moveChoice(choicesOf(taberu()), 2, -1)), [0, 2, 1])
    assert.deepStrictEqual(layoutOf(choicesOf(taberu([false, true, true]))), [1, 2])
  })
})

describe("a sense's hint in reviews", () => {
  const label = (code: LabelCode, severity: Label["severity"] = "info"): Label => ({ code, severity, source: "jmdict" })

  it("words the labels worth a hint, the word's then the sense's", () => {
    const note = taberu()
    const withLabels = {
      ...note,
      entry: { ...note.entry, labels: [label("col"), label("id", "quiet")] }
    }
    const sense = { ...note.senses[1]!, labels: [label("male")] }
    assert.strictEqual(senseHint(t, withLabels, sense), `${t.labels.name.col} · ${t.labels.name.male}`)
    assert.strictEqual(senseHint(t, note, note.senses[0]!), null)
  })
})
