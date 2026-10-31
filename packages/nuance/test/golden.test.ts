import { assert, describe, it } from "@effect/vitest"
import type { ChoiceQuestion } from "@typesafe-ai/sdk"
import { Schema } from "effect"
import { readFileSync } from "node:fs"
import {
  entryRequest,
  loanRequest,
  GOLDEN_ENGLISH_PAIRS,
  GOLDEN_ENGLISH_SENSES,
  GOLDEN_PAIRS,
  GOLDEN_SENSES,
  GoldenFixture,
  goldenEnglishEntry,
  goldenEntry,
  goldenLoanRequest,
  goldenSenseRequest,
  MAX_SENSES,
  readGolden,
  REVERSED,
  withReversedChoices
} from "../src/index.ts"

const fixture = Schema.decodeUnknownSync(Schema.fromJsonString(GoldenFixture))(
  readFileSync(new URL("../golden/entries.json", import.meta.url), "utf8")
)
const entries = new Map(fixture.entries.map((entry) => [entry.id, goldenEntry(entry)]))
const tags = new Map(Object.entries(fixture.tags))

describe("the golden fixture", () => {
  it("holds every sense the golden set judges; regenerate it with `pnpm golden`", () => {
    for (const golden of [...GOLDEN_SENSES, ...GOLDEN_PAIRS]) {
      assert.isDefined(entries.get(golden.entryId)?.senses[golden.sense], `${golden.word} #${golden.entryId}`)
    }
    for (const pair of GOLDEN_PAIRS) {
      assert.isDefined(entries.get(pair.similarId)?.senses[pair.similarSense], `${pair.similar} #${pair.similarId}`)
    }
    // English words are named by headword, each sense by how its glosses start.
    for (const golden of GOLDEN_ENGLISH_SENSES) {
      const entry = goldenEnglishEntry(entries.values(), golden.word)
      assert.isBelow(golden.sense, MAX_SENSES, `${golden.word} #${golden.sense} is never judged`)
      const glosses = (entry?.senses[golden.sense]?.glosses ?? []).map((gloss) => gloss.text).join("、")
      assert.isTrue(glosses.startsWith(golden.gloss), `${golden.word} #${golden.sense}: ${glosses}`)
    }
    for (const pair of GOLDEN_ENGLISH_PAIRS) {
      assert.isDefined(goldenEnglishEntry(entries.values(), pair.word)?.senses[pair.sense], pair.word)
      assert.isDefined(goldenEnglishEntry(entries.values(), pair.similar)?.senses[pair.similarSense], pair.similar)
    }
  })
})

describe("golden requests", () => {
  const entry = entries.get(1612690)! // ございます: three senses, all tagged polite
  const request = goldenSenseRequest(entry, 1, tags)

  it("send what production sends for the sense, with every Choice asked again in reverse order", () => {
    const production = entryRequest(entry, tags)
    assert.deepStrictEqual(request.state, production.state)
    assert.strictEqual(request.prefix, "s1_")
    for (const [key, question] of Object.entries(production.questions)) {
      if (!key.startsWith("s1_")) {
        assert.isUndefined(request.questions[key])
        continue
      }
      assert.deepStrictEqual(request.questions[key], question)
      const reversed = request.questions[`${key}${REVERSED}`]
      if (question.type !== "choice") assert.isUndefined(reversed)
      else
        assert.deepStrictEqual(
          Object.keys((reversed as ChoiceQuestion).criteria),
          Object.keys(question.criteria).toReversed()
        )
    }
    const scope = request.questions["s1_formality"]?.instructions as { meaning: string; part_of_speech: Array<string> }
    assert.strictEqual(scope.meaning, "to be (doing)")
    assert.deepStrictEqual(scope.part_of_speech, ["auxiliary verb"])
  })

  it("read whether a Choice held up with its options reversed", () => {
    const pick = (choice: string) => ({ type: "choice", choice, confidence: 0.5, probabilities: {} })
    const keigo = `${request.prefix}keigo`
    const gender = `${request.prefix}gender`
    const reading = readGolden(request, {
      [keigo]: pick("none"),
      [`${keigo}${REVERSED}`]: pick("bikago"),
      [gender]: pick("neutral"),
      [`${gender}${REVERSED}`]: pick("neutral")
    })
    assert.deepStrictEqual(reading.order, [
      { name: "keigo", flipped: true, towardFirst: true },
      { name: "gender", flipped: false, towardFirst: false }
    ])
    assert.deepStrictEqual(Object.keys(reading.answers), ["keigo", `keigo${REVERSED}`, "gender", `gender${REVERSED}`])
  })

  it("ask about an English word's katakana loans as the nuance job does, without its senses", () => {
    const style = goldenEnglishEntry(entries.values(), "style")!
    const candidates = (fixture.loans["style"]?.glossesOnly ?? []).map(({ entryId }) => entries.get(entryId)!)
    const loans = goldenLoanRequest(style, candidates, tags)
    // The nuance job already asks the loan Choice in both option orders, so the eval adds nothing.
    assert.deepStrictEqual(loans, { ...loanRequest(style, candidates, tags), prefix: "" })
    assert.deepStrictEqual(loans.state, { word: "style", reading: "/staɪl/" })
    assert.deepStrictEqual(
      Object.keys(loans.questions),
      candidates.flatMap((_, k) => [`loanword_${k}`, `loan_${k}`, `loan_${k}${REVERSED}`])
    )
    assert.deepStrictEqual(withReversedChoices(loans.questions), loans.questions)
  })
})
