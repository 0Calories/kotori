import type { Enrichment, EnrichmentStatus } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { ApiError } from "../src/api/errors.ts"
import { strings } from "../src/i18n/strings.ts"
import {
  type Ask,
  enrichmentNotice,
  enrichmentPhase,
  isComing,
  POLL_MS,
  pollInterval,
  progressKey,
  shouldAsk,
  shouldRefresh,
  writingExamples
} from "../src/lib/enrichment.ts"

const t = strings.en

const enrichment = (examples: EnrichmentStatus, audio: EnrichmentStatus = examples): Enrichment => ({ examples, audio })

const queued = enrichment("queued")
const ready = enrichment("ready")
const idle: Ask = { status: "idle", error: null }
const pending: Ask = { status: "pending", error: null }
const success: Ask = { status: "success", error: null }
const failed = (error: unknown): Ask => ({ status: "error", error })
const limited = (afterSeconds: number) =>
  new ApiError("RateLimited", "slow down", null, { afterSeconds, at: Date.now() + afterSeconds * 1000 })

describe("isComing", () => {
  it("is true while examples or audio are on their way", () => {
    assert.isTrue(isComing(queued))
    assert.isTrue(isComing(enrichment("ready", "queued")))
    assert.isTrue(isComing(enrichment("queued", "unavailable")))
  })

  it("is false once everything has settled, either way, or with nothing loaded", () => {
    assert.isFalse(isComing(ready))
    assert.isFalse(isComing(enrichment("ready", "unavailable")))
    assert.isFalse(isComing(enrichment("unavailable")))
    assert.isFalse(isComing(undefined))
  })
})

describe("shouldAsk", () => {
  const base = { id: 7, onScreen: queued, settled: true, askedFor: null }

  it("asks for an entry that shows something on its way", () => {
    assert.isTrue(shouldAsk(base))
    assert.isTrue(shouldAsk({ ...base, onScreen: enrichment("ready", "queued") }))
  })

  it("asks once per entry an opening shows", () => {
    assert.isFalse(shouldAsk({ ...base, askedFor: 7 }))
    // The same screen showing another entry asks for that one.
    assert.isTrue(shouldAsk({ ...base, askedFor: 3 }))
  })

  it("waits for the entry to be fetched, so a stale copy doesn't decide", () => {
    assert.isFalse(shouldAsk({ ...base, settled: false }))
  })

  it("doesn't ask when nothing is on its way, or nothing is loaded", () => {
    assert.isFalse(shouldAsk({ ...base, onScreen: ready }))
    assert.isFalse(shouldAsk({ ...base, onScreen: enrichment("unavailable") }))
    assert.isFalse(shouldAsk({ ...base, onScreen: undefined }))
  })
})

describe("pollInterval", () => {
  it("polls every few seconds while something is on its way", () => {
    assert.strictEqual(pollInterval(queued), POLL_MS)
    assert.strictEqual(pollInterval(enrichment("ready", "queued")), POLL_MS)
  })

  it("stops as soon as nothing is", () => {
    assert.isFalse(pollInterval(ready))
    assert.isFalse(pollInterval(enrichment("ready", "unavailable")))
    assert.isFalse(pollInterval(undefined))
  })
})

describe("shouldRefresh", () => {
  it("fetches the entry when something became ready", () => {
    assert.isTrue(shouldRefresh(queued, enrichment("ready", "queued"), null))
    assert.isTrue(shouldRefresh(queued, ready, null))
  })

  it("fetches the entry when something stopped coming", () => {
    assert.isTrue(shouldRefresh(queued, enrichment("unavailable", "queued"), null))
  })

  it("leaves the entry alone while progress matches it, or there is none", () => {
    assert.isFalse(shouldRefresh(queued, queued, null))
    assert.isFalse(shouldRefresh(queued, undefined, null))
  })

  it("fetches the entry once per reading", () => {
    const reading = enrichment("ready", "queued")
    assert.isFalse(shouldRefresh(queued, reading, progressKey(reading)))
    // A later reading that moved again fetches it again.
    assert.isTrue(shouldRefresh(queued, ready, progressKey(reading)))
  })
})

describe("enrichmentPhase", () => {
  it("is about to ask while the entry shows something on its way", () => {
    assert.strictEqual(enrichmentPhase(queued, undefined, idle), "asking")
    assert.strictEqual(enrichmentPhase(queued, undefined, pending), "asking")
  })

  it("is settled when nothing is on its way and nothing was asked", () => {
    assert.strictEqual(enrichmentPhase(ready, undefined, idle), "settled")
    assert.strictEqual(enrichmentPhase(enrichment("unavailable"), undefined, idle), "settled")
  })

  it("waits once the ask went through, until the entry shows nothing coming", () => {
    assert.strictEqual(enrichmentPhase(queued, queued, success), "waiting")
    // Progress says ready but the entry hasn't been fetched again yet.
    assert.strictEqual(enrichmentPhase(queued, ready, success), "waiting")
    // Asked from the button on a dictionary-only entry: progress is what says it's coming.
    assert.strictEqual(enrichmentPhase(enrichment("unavailable"), queued, success), "waiting")
    assert.strictEqual(enrichmentPhase(ready, ready, success), "settled")
  })

  it("is limited when the ask was refused for asking too much", () => {
    assert.strictEqual(enrichmentPhase(queued, undefined, failed(limited(600))), "limited")
  })

  it("has failed on any other failure", () => {
    assert.strictEqual(enrichmentPhase(queued, undefined, failed(new ApiError("Offline", ""))), "failed")
    assert.strictEqual(enrichmentPhase(queued, undefined, failed(new ApiError("Unexpected", ""))), "failed")
    assert.strictEqual(enrichmentPhase(queued, undefined, failed(new Error("boom"))), "failed")
  })
})

describe("writingExamples", () => {
  it("says Kotori is writing while examples are on their way and the ask is going or went through", () => {
    assert.isTrue(writingExamples("asking", queued, undefined))
    assert.isTrue(writingExamples("waiting", queued, ready))
    assert.isTrue(writingExamples("waiting", enrichment("unavailable"), queued))
  })

  it("says nothing for audio alone", () => {
    assert.isFalse(writingExamples("waiting", enrichment("ready", "queued"), enrichment("ready", "queued")))
  })

  it("says nothing once the ask was refused or failed, as nothing is coming then", () => {
    assert.isFalse(writingExamples("limited", queued, undefined))
    assert.isFalse(writingExamples("failed", queued, undefined))
  })
})

describe("enrichmentNotice", () => {
  it("says Kotori will write more later, with when to come back", () => {
    assert.strictEqual(
      enrichmentNotice(t, "limited", limited(30 * 60)),
      "Kotori has been writing lots of examples and is taking a breather. Come back to this word in 30 minutes for more."
    )
    assert.include(enrichmentNotice(t, "limited", limited(3 * 3600)) ?? "", "in 3 hours")
    assert.include(enrichmentNotice(t, "limited", limited(10)) ?? "", "in a minute")
    assert.include(enrichmentNotice(strings.ja, "limited", limited(30 * 60)) ?? "", "30分ほど")
  })

  it("words any other failure from the app's own strings", () => {
    assert.strictEqual(enrichmentNotice(t, "failed", new ApiError("Offline", "")), t.common.offline)
    assert.strictEqual(enrichmentNotice(t, "failed", new ApiError("Unexpected", "500")), t.common.errors.trouble)
  })

  it("says nothing otherwise", () => {
    assert.isNull(enrichmentNotice(t, "asking", null))
    assert.isNull(enrichmentNotice(t, "waiting", null))
    assert.isNull(enrichmentNotice(t, "settled", null))
  })
})
