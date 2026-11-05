import { describe, expect, it } from "vitest"
import { interpretTriage, triageRequest } from "../src/asks/triage.ts"

const choice = (probabilities: Record<string, number>) => {
  const best = Object.entries(probabilities).toSorted(([, a], [, b]) => b - a)[0]!
  return { type: "choice", choice: best[0], confidence: best[1], probabilities }
}

describe("interpretTriage", () => {
  it("asks the routing question in both option orders, about the query and the two languages", () => {
    const request = triageRequest("bussin", "en")
    expect(request.state).toEqual({ query: "bussin", target_language: "English", native_language: "Japanese" })
    expect(Object.keys(request.questions)).toEqual(["route", "route~reversed"])
    expect(Object.keys(request.questions["route~reversed"]!.criteria)).toEqual(
      Object.keys(request.questions["route"]!.criteria).toReversed()
    )
  })

  it("averages the two orders and routes lookups at half", () => {
    const triage = interpretTriage({
      route: choice({ lookup: 0.4, garbage: 0.6 }),
      "route~reversed": choice({ lookup: 0.7, garbage: 0.3 })
    })
    expect(triage).toMatchObject({ route: "lookup", decided: true })
    expect(triage.probabilities.lookup).toBeCloseTo(0.55)
  })

  it("turns a query away only when sure of another route, and falls open to a lookup otherwise", () => {
    expect(interpretTriage({ route: choice({ lookup: 0.1, sentence: 0.85, name: 0.05 }) })).toMatchObject({
      route: "sentence",
      decided: true
    })
    expect(interpretTriage({ route: choice({ lookup: 0.3, name: 0.4, garbage: 0.3 }) })).toMatchObject({
      route: "lookup",
      decided: false
    })
    expect(interpretTriage({})).toMatchObject({ route: "lookup", decided: false })
  })
})
