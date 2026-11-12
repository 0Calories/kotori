import type { EntryId, NoteId, ReviewItem } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { shownReviewNote } from "../src/lib/review.ts"

const item = (id: string, good = "1d"): ReviewItem => ({
  note: {
    id: id as NoteId,
    createdAt: new Date(0),
    retentionStage: "review",
    due: new Date(0),
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

describe("the note on screen during review", () => {
  it("opens on the first due note", () => {
    assert.strictEqual(shownReviewNote([item("r1"), item("n1")], null, new Set())?.note.id, "r1")
    assert.strictEqual(shownReviewNote([], null, new Set()), undefined)
  })

  it("keeps the opening note when a refetch puts a different note first", () => {
    const opening = [item("r1"), item("n1"), item("r2")]
    const shown = shownReviewNote(opening, null, new Set())
    assert.strictEqual(shown?.note.id, "r1")

    // A learning note came due, so gathering again jumped it ahead of r1.
    const refetched = [item("l1"), ...opening]
    assert.strictEqual(refetched[0]?.note.id, "l1")
    assert.strictEqual(shownReviewNote(refetched, shown ?? null, new Set())?.note.id, "r1")
  })

  it("keeps the note an answer advanced to when gathering again would show another", () => {
    const before = [item("r1"), item("n1"), item("r2"), item("n2")]
    const shown = shownReviewNote(before, null, new Set())
    assert.strictEqual(shown?.note.id, "r1")

    // The session pins this before refetching: the next of the due notes it already has.
    const answered = new Set(["r1"])
    const advanced = shownReviewNote(before, shown ?? null, answered)
    assert.strictEqual(advanced?.note.id, "n1")

    // New notes get re-spaced among the reviews that remain, so r2 is now the head.
    const regathered = [item("r2"), item("n1"), item("n2")]
    assert.notStrictEqual(regathered[0]?.note.id, advanced?.note.id)
    assert.strictEqual(shownReviewNote(regathered, advanced ?? null, answered)?.note.id, "n1")

    // The answer settles and r1 leaves the local answered set. n1 stays.
    assert.strictEqual(shownReviewNote(regathered, advanced ?? null, new Set())?.note.id, "n1")
  })

  it("holds a note a refetch dropped until that note is answered", () => {
    const shown = shownReviewNote([item("r1"), item("n1")], null, new Set())
    assert.strictEqual(shownReviewNote([item("n1")], shown ?? null, new Set())?.note.id, "r1")
    assert.strictEqual(shownReviewNote([item("n1")], shown ?? null, new Set(["r1"]))?.note.id, "n1")
  })

  it("uses the newer copy of the pinned note", () => {
    const shown = shownReviewNote([item("r1", "1d")], null, new Set())
    const refreshed = shownReviewNote([item("r1", "2d"), item("n1")], shown ?? null, new Set())
    assert.strictEqual(refreshed?.note.id, "r1")
    assert.strictEqual(refreshed?.labels.good, "2d")
  })

  it("shows a note again once a failed answer pins it back", () => {
    const due = [item("r1"), item("n1")]
    const shown = shownReviewNote(due, null, new Set())
    const advanced = shownReviewNote(due, shown ?? null, new Set(["r1"]))
    assert.strictEqual(advanced?.note.id, "n1")
    // The request failed: the session pins r1 again and clears the answered mark.
    assert.strictEqual(shownReviewNote(due, shown ?? null, new Set())?.note.id, "r1")
  })
})
