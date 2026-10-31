import { assert, describe, it } from "vitest"
import { bulkPlan } from "../src/commands/enrich.ts"

describe("a bulk enrichment's plan", () => {
  it("says how many entries and roughly what they cost before anything is sent", () => {
    // Re-judging every common entry: about 32k, at 20k Jev tokens each.
    assert.strictEqual(bulkPlan("nuance", 32_000), "Would enrich 32,000 entries with nuance (Jev, about $26.88).")
    assert.strictEqual(bulkPlan("examples", 500), "Would enrich 500 entries with examples (Claude, about $15.00).")
    assert.strictEqual(
      bulkPlan("audio", 100),
      "Would enrich 100 entries with audio (ElevenLabs, billed per character)."
    )
  })
})
