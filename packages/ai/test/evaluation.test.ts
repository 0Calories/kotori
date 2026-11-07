import { describe, expect, it } from "vitest"
import { triageRequest } from "../src/asks/triage.ts"
import { orderChecks } from "../src/eval/evaluation.ts"

const pick = (choice: string) => ({ type: "choice", choice, confidence: 0.5, probabilities: {} })

describe("orderChecks", () => {
  it("read whether a Choice held up with its options reversed", () => {
    const { questions } = triageRequest("bussin", "en")
    // The reversed twin lists garbage first: each order picked its own first option.
    expect(orderChecks(questions, { route: pick("lookup"), "route~reversed": pick("garbage") })).toEqual([
      { name: "route", flipped: true, towardFirst: true }
    ])
    expect(orderChecks(questions, { route: pick("name"), "route~reversed": pick("name") })).toEqual([
      { name: "route", flipped: false, towardFirst: false }
    ])
    // A Choice answered one way only, or a twin, isn't compared on its own.
    expect(orderChecks(questions, { route: pick("lookup") })).toEqual([])
  })
})
