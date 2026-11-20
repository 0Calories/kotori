import { describe, expect, it } from "vitest"
import { triageRequest } from "../src/asks/triage.ts"
import { orderChecks } from "../src/eval/evaluation.ts"

const pick = (choice: string) => ({ type: "choice", choice, confidence: 0.5, probabilities: {} })

describe("orderChecks", () => {
  it("read whether a Choice held up with its options reversed", () => {
    const { questions } = triageRequest("bussin", "en")
    expect(orderChecks(questions, { route: pick("lookup"), "route~reversed": pick("garbage") })).toEqual([
      { name: "route", flipped: true, towardFirst: true }
    ])
    expect(orderChecks(questions, { route: pick("name"), "route~reversed": pick("name") })).toEqual([
      { name: "route", flipped: false, towardFirst: false }
    ])
    expect(orderChecks(questions, { route: pick("lookup") })).toEqual([])
  })
})
