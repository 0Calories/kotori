import type { DraftEntry, EntryId, EntrySummary, Proposal, ProposalId } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import {
  ASK_MIN_THINKING_MS,
  ASK_PONDER_STAGE,
  ASK_STAGE_STARTS,
  type AskAttempt,
  type AskError,
  askAnswer,
  askFailure,
  askMood,
  askProgress,
  askRevealAt,
  askStage,
  askView,
  draftHeadwordSize,
  formatWait,
  retryable
} from "../src/lib/ask.ts"

const draft: DraftEntry = {
  id: 200000001 as EntryId,
  headword: "ぴえん",
  reading: "ぴえん",
  spellings: [],
  frequency: 4,
  labels: [{ code: "net-sl", severity: "warning", source: "kotori" }],
  senses: [
    {
      index: 0,
      glosses: ["boo-hoo (crying sound)"],
      partsOfSpeech: [{ code: "int", name: "interjection" }],
      labels: [],
      usagePatterns: []
    }
  ],
  cautions: []
}

const entry: EntrySummary = {
  id: 1 as EntryId,
  language: "en",
  review: "approved",
  headword: "it is what it is",
  reading: "",
  common: false,
  romaji: "",
  meanings: ["しかたがない"],
  partOfSpeech: "exp",
  labels: [],
  inflection: [],
  audioUrl: null
}

const proposal = (fields: Partial<Proposal>): Proposal => ({
  id: 7 as ProposalId,
  query: "ぴえん",
  language: "ja",
  status: "pending",
  draft: null,
  linked: null,
  reason: null,
  route: null,
  ...fields
})

const attempt = (fields: Partial<AskAttempt>): AskAttempt => ({
  status: "pending",
  error: null,
  data: undefined,
  submittedAt: 10_000,
  ...fields
})

const apiError = (fields: Partial<AskError>): AskError => ({ tag: "Unexpected", refusal: null, retry: null, ...fields })

/** `askView` with nothing asked, nothing on record and Kotori free to offer, unless the test says otherwise. */
const view = (input: Partial<Parameters<typeof askView>[0]>) =>
  askView({
    attempt: undefined,
    proposal: null,
    offerable: true,
    watched: false,
    now: 0,
    toError: (error) => error as AskError,
    ...input
  })

describe("Kotori's thinking status", () => {
  it("starts on the first line and moves to each next one only once its time has come", () => {
    assert.strictEqual(askStage(0), 0)
    ASK_STAGE_STARTS.forEach((start, index) => {
      if (index > 0) assert.strictEqual(askStage(start - 1), index - 1)
      assert.strictEqual(askStage(start), index)
    })
  })

  it("stays on the last line however long the wait", () => {
    assert.strictEqual(askStage(10 * 60_000), ASK_STAGE_STARTS.length - 1)
  })
})

describe("the thinking bar", () => {
  it("shows a sliver the moment Kotori is asked", () => {
    assert.isAbove(askProgress(0), 0)
    assert.isBelow(askProgress(0), 0.1)
    assert.strictEqual(askProgress(-500), askProgress(0))
  })

  it("is about half full after seven seconds", () => {
    assert.closeTo(askProgress(7000), 0.5, 0.06)
  })

  it("keeps filling for as long as an ask could take, but never reaches the end", () => {
    let last = askProgress(0)
    // The bar's clock runs two minutes, far past any answer.
    for (let ms = 1000; ms <= 120_000; ms += 1000) {
      const next = askProgress(ms)
      assert.isAbove(next, last)
      last = next
    }
    assert.isBelow(askProgress(60 * 60_000), 0.95)
  })
})

describe("the wait before asking again", () => {
  it("reads as minutes and seconds, rounded up so it never shows zero too soon", () => {
    assert.strictEqual(formatWait(27_000), "0:27")
    assert.strictEqual(formatWait(26_001), "0:27")
    assert.strictEqual(formatWait(1), "0:01")
    assert.strictEqual(formatWait(60_000), "1:00")
    assert.strictEqual(formatWait(582_000), "9:42")
  })

  it("never goes below zero", () => {
    assert.strictEqual(formatWait(0), "0:00")
    assert.strictEqual(formatWait(-3000), "0:00")
  })
})

describe("an answer on record", () => {
  it("shows a pending proposal as its draft", () => {
    assert.deepStrictEqual(askAnswer(proposal({ status: "pending", draft })), { kind: "draft", draft })
  })

  it("shows a link, and a draft since approved, as the entry it names", () => {
    assert.deepStrictEqual(askAnswer(proposal({ status: "linked", linked: entry })), {
      kind: "linked",
      entry,
      approved: false
    })
    assert.deepStrictEqual(askAnswer(proposal({ status: "approved", draft, linked: entry })), {
      kind: "linked",
      entry,
      approved: true
    })
  })

  it("has nothing to show once the entry a link named is gone", () => {
    assert.isNull(askAnswer(proposal({ status: "linked", linked: null })))
  })

  it("points a query that isn't a lookup elsewhere, and keeps Claude's reason for one that is", () => {
    assert.deepStrictEqual(askAnswer(proposal({ status: "rejected", route: "sentence" })), {
      kind: "rejected",
      reason: null,
      route: "sentence"
    })
    assert.deepStrictEqual(
      askAnswer(proposal({ status: "rejected", route: "lookup", reason: "Not a word; did you mean …?" })),
      { kind: "rejected", reason: "Not a word; did you mean …?", route: null }
    )
  })

  it("never shows a discarded draft as if it were still waiting for review", () => {
    assert.deepStrictEqual(askAnswer(proposal({ status: "discarded", draft, reason: "Too rare" })), {
      kind: "discarded",
      reason: "Too rare"
    })
  })
})

describe("a failed ask", () => {
  it("is refused for good when Kotori turned the query away", () => {
    const failure = askFailure(apiError({ tag: "AskRefused", refusal: "keyboard" }))
    assert.deepStrictEqual(failure, { kind: "refused", refusal: "keyboard" })
    assert.isFalse(retryable(failure))
  })

  it("waits out a rate limit, by how long the server says to wait", () => {
    const at = 50_000
    assert.deepStrictEqual(askFailure(apiError({ tag: "RateLimited", retry: { afterSeconds: 30, at } })), {
      kind: "busy",
      retryAt: at
    })
    assert.deepStrictEqual(askFailure(apiError({ tag: "RateLimited", retry: { afterSeconds: 600, at } })), {
      kind: "resting",
      retryAt: at
    })
    const napping = askFailure(apiError({ tag: "RateLimited", retry: { afterSeconds: 3600, at } }))
    assert.deepStrictEqual(napping, { kind: "napping" })
    assert.isFalse(retryable(napping))
  })

  it("can be tried again at once when the server gave no wait", () => {
    assert.deepStrictEqual(askFailure(apiError({ tag: "RateLimited" })), { kind: "busy", retryAt: 0 })
  })

  it("can be tried again when Claude or the connection let Kotori down", () => {
    for (const [tag, kind] of [
      ["AiUnavailable", "unavailable"],
      ["Offline", "offline"],
      ["Unexpected", "unexpected"]
    ] as const) {
      const failure = askFailure(apiError({ tag }))
      assert.deepStrictEqual(failure, { kind })
      assert.isTrue(retryable(failure))
    }
    assert.deepStrictEqual(askFailure(null), { kind: "unexpected" })
  })
})

describe("what the Ask Kotori panel shows", () => {
  it("offers to ask when nothing is on record, and stays quiet when the query can't be asked", () => {
    assert.deepStrictEqual(view({}), { phase: "offer" })
    assert.deepStrictEqual(view({ offerable: false }), { phase: "quiet" })
  })

  it("thinks while the ask is in flight", () => {
    assert.deepStrictEqual(view({ attempt: attempt({ status: "pending" }) }), { phase: "thinking", since: 10_000 })
  })

  it("keeps thinking a moment when an answer it watched comes back at once, then shows it with a flourish", () => {
    const answered = attempt({ status: "success", data: proposal({ draft }) })
    const early = 10_000 + ASK_MIN_THINKING_MS - 1
    assert.deepStrictEqual(view({ attempt: answered, watched: true, now: early }), {
      phase: "thinking",
      since: 10_000
    })
    assert.deepStrictEqual(view({ attempt: answered, watched: true, now: early + 1 }), {
      phase: "answered",
      answer: { kind: "draft", draft },
      live: true
    })
    assert.strictEqual(askRevealAt(answered, true), early + 1)
  })

  it("shows an answer it didn't watch arrive at once, without a flourish", () => {
    const answered = attempt({ status: "success", data: proposal({ draft }) })
    assert.deepStrictEqual(view({ attempt: answered, now: 10_001 }), {
      phase: "answered",
      answer: { kind: "draft", draft },
      live: false
    })
    assert.isNull(askRevealAt(answered, false))
  })

  it("shows a past answer from the learner's asks without asking again", () => {
    assert.deepStrictEqual(view({ proposal: proposal({ status: "linked", linked: entry }) }), {
      phase: "answered",
      answer: { kind: "linked", entry, approved: false },
      live: false
    })
  })

  it("says why an ask it watched failed", () => {
    const failed = attempt({ status: "error", error: apiError({ tag: "Offline" }) })
    assert.deepStrictEqual(view({ attempt: failed, watched: true, now: 20_000 }), {
      phase: "failed",
      failure: { kind: "offline" },
      live: true
    })
  })

  it("prefers an answer on record to a failure, since a dropped connection may have been answered anyway", () => {
    const failed = attempt({ status: "error", error: apiError({ tag: "Offline" }) })
    assert.deepStrictEqual(view({ attempt: failed, proposal: proposal({ draft }), now: 20_000 }), {
      phase: "answered",
      answer: { kind: "draft", draft },
      live: false
    })
  })

  it("doesn't offer to ask again about a query whose answer has nothing left to show", () => {
    assert.deepStrictEqual(view({ proposal: proposal({ status: "linked", linked: null }) }), { phase: "quiet" })
  })
})

describe("Kotori's pose in the panel", () => {
  it("is unsure over an empty search and curious over lookalikes", () => {
    assert.deepStrictEqual(askMood({ phase: "offer" }, "none"), { mood: "oops", facing: "front" })
    assert.deepStrictEqual(askMood({ phase: "offer" }, "weak"), { mood: "neutral", facing: "front" })
  })

  it("reads while asked", () => {
    assert.deepStrictEqual(askMood({ phase: "thinking", since: 0 }, "none"), { mood: "reading", facing: "front" })
  })

  it("reads through the first status lines, then thinks it over", () => {
    const thinking = { phase: "thinking", since: 0 } as const
    ASK_STAGE_STARTS.forEach((_, stage) => {
      assert.strictEqual(
        askMood(thinking, "none", stage).mood,
        stage < ASK_PONDER_STAGE ? "reading" : "thinking",
        `status line ${stage}`
      )
    })
  })

  it("celebrates side on (so its confetti flies) at a fresh draft, and is glad to see one again", () => {
    const answer = { kind: "draft", draft } as const
    assert.deepStrictEqual(askMood({ phase: "answered", answer, live: true }, "none"), {
      mood: "celebrate",
      facing: "left"
    })
    assert.deepStrictEqual(askMood({ phase: "answered", answer, live: false }, "none"), {
      mood: "happy",
      facing: "front"
    })
  })

  it("is flustered at a failure, and asleep once the learner's asks are used up", () => {
    assert.strictEqual(askMood({ phase: "failed", failure: { kind: "offline" }, live: true }, "none").mood, "oops")
    assert.strictEqual(
      askMood({ phase: "failed", failure: { kind: "resting", retryAt: 0 }, live: true }, "none").mood,
      "sleepy"
    )
    assert.strictEqual(askMood({ phase: "failed", failure: { kind: "napping" }, live: true }, "none").mood, "sleepy")
  })
})

describe("a draft's headword size", () => {
  it("is large for short words and shrinks for long ones, but stays readable", () => {
    assert.strictEqual(draftHeadwordSize("bussin", "en"), 36)
    assert.strictEqual(draftHeadwordSize("ぴえん", "ja"), 42)
    assert.isBelow(draftHeadwordSize("it is what it is", "en"), 36)
    assert.isAtLeast(draftHeadwordSize("a very long english idiom indeed", "en"), 22)
    assert.isAtLeast(draftHeadwordSize("とても長い日本語の慣用句です", "ja"), 24)
  })
})
