import type { CardId, EntryId, NoteId, ReviewItem } from "@kotori/domain"
import { assert, describe, it } from "vitest"
import { shownReviewCard } from "../src/lib/review.ts"

const item = (id: string, good = "1d"): ReviewItem => ({
  card: {
    id: id as CardId,
    noteId: "note" as NoteId,
    template: "recognize",
    queue: "review",
    due: 0,
    interval: 1,
    ease: 2.5,
    reps: 1,
    lapses: 0,
    leech: false,
    content: {
      kind: "word",
      entryId: 1 as EntryId,
      senseIndex: 0,
      headword: id,
      reading: id,
      meaning: id,
      hint: null,
      example: null,
      audioUrl: null
    }
  },
  labels: { again: "1m", hard: "1d", good, easy: "4d" }
})

describe("the card on screen during review", () => {
  it("opens on the head of the queue", () => {
    assert.strictEqual(shownReviewCard([item("r1"), item("n1")], null, new Set())?.card.id, "r1")
    assert.strictEqual(shownReviewCard([], null, new Set()), undefined)
  })

  it("keeps the opening card when a refetch puts a different card first", () => {
    const opening = [item("r1"), item("n1"), item("r2")]
    const shown = shownReviewCard(opening, null, new Set())
    assert.strictEqual(shown?.card.id, "r1")

    // A learning card came due, so gathering again jumped it ahead of r1.
    const refetched = [item("l1"), ...opening]
    assert.strictEqual(refetched[0]?.card.id, "l1")
    assert.strictEqual(shownReviewCard(refetched, shown ?? null, new Set())?.card.id, "r1")
  })

  it("keeps the card an answer advanced to when gathering again would show another", () => {
    const before = [item("r1"), item("n1"), item("r2"), item("n2")]
    const shown = shownReviewCard(before, null, new Set())
    assert.strictEqual(shown?.card.id, "r1")

    // The session pins this before refetching: the next card in the queue it already has.
    const answered = new Set(["r1"])
    const advanced = shownReviewCard(before, shown ?? null, answered)
    assert.strictEqual(advanced?.card.id, "n1")

    // New cards get re-spaced among the reviews that remain, so r2 is now the head.
    const regathered = [item("r2"), item("n1"), item("n2")]
    assert.notStrictEqual(regathered[0]?.card.id, advanced?.card.id)
    assert.strictEqual(shownReviewCard(regathered, advanced ?? null, answered)?.card.id, "n1")

    // The answer settles and r1 leaves the local answered set. n1 stays.
    assert.strictEqual(shownReviewCard(regathered, advanced ?? null, new Set())?.card.id, "n1")
  })

  it("holds a card a refetch dropped until that card is answered", () => {
    const shown = shownReviewCard([item("r1"), item("n1")], null, new Set())
    assert.strictEqual(shownReviewCard([item("n1")], shown ?? null, new Set())?.card.id, "r1")
    assert.strictEqual(shownReviewCard([item("n1")], shown ?? null, new Set(["r1"]))?.card.id, "n1")
  })

  it("uses the queue's newer copy of the pinned card", () => {
    const shown = shownReviewCard([item("r1", "1d")], null, new Set())
    const refreshed = shownReviewCard([item("r1", "2d"), item("n1")], shown ?? null, new Set())
    assert.strictEqual(refreshed?.card.id, "r1")
    assert.strictEqual(refreshed?.labels.good, "2d")
  })

  it("shows a card again once a failed answer pins it back", () => {
    const queue = [item("r1"), item("n1")]
    const shown = shownReviewCard(queue, null, new Set())
    const advanced = shownReviewCard(queue, shown ?? null, new Set(["r1"]))
    assert.strictEqual(advanced?.card.id, "n1")
    // The request failed: the session pins r1 again and clears the answered mark.
    assert.strictEqual(shownReviewCard(queue, shown ?? null, new Set())?.card.id, "r1")
  })
})
