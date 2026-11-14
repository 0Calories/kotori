import { assert, describe, it } from "@effect/vitest"
import { enrichmentStatus } from "../src/features/dictionary/enrichmentStatus.ts"

describe("enrichmentStatus", () => {
  it("is ready whenever the entry has it, whatever its provider and job", () => {
    for (const available of [true, false]) {
      for (const job of [undefined, "queued", "running", "done", "failed"] as const) {
        assert.strictEqual(enrichmentStatus(true, available, job), "ready")
      }
    }
  })

  it("is unavailable without a provider, even with a job waiting", () => {
    for (const job of [undefined, "queued", "running", "done", "failed"] as const) {
      assert.strictEqual(enrichmentStatus(false, false, job), "unavailable")
    }
  })

  it("follows the job when a provider is there: only an unsettled job is on its way", () => {
    assert.strictEqual(enrichmentStatus(false, true, undefined), "unrequested")
    assert.strictEqual(enrichmentStatus(false, true, "queued"), "queued")
    assert.strictEqual(enrichmentStatus(false, true, "running"), "queued")
    assert.strictEqual(enrichmentStatus(false, true, "done"), "unavailable")
    assert.strictEqual(enrichmentStatus(false, true, "failed"), "unavailable")
  })
})
