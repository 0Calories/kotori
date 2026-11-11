import type { EntryId, NoteId, ReviewItem } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import {
  initialReviewSession,
  reduceReviewSession,
  reviewKeyAction,
  reviewView,
  waitRefetchDelay,
  WAIT_RETRY_MS,
  type ReviewSessionEvent,
  type ReviewSessionState
} from "../src/lib/reviewSession.ts"

const item = (id: string): ReviewItem => ({
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
  labels: { again: "1m", hard: "1d", good: "1d", easy: "4d" }
})

const run = (events: readonly ReviewSessionEvent[], from: ReviewSessionState = initialReviewSession) =>
  events.reduce(reduceReviewSession, from)

const [A, B, C] = [item("a"), item("b"), item("c")] as const
const due = [A, B, C]
const open = (): ReviewSessionEvent[] => [
  { type: "pin", item: A },
  { type: "reveal", noteId: "a" }
]
const answerA: ReviewSessionEvent = { type: "answer", item: A, rating: "good", items: due }

describe("review session reducer", () => {
  it("advances to the next note unrevealed and counts the answer", () => {
    const state = run([...open(), answerA])
    const view = reviewView(state, due)
    assert.strictEqual(view.current?.note.id, "b")
    assert.isFalse(view.revealed)
    assert.strictEqual(state.reviewed, 1)
    assert.deepStrictEqual(state.inFlight, ["a"])
  })

  it("does not answer a note that isn't revealed, or answer twice", () => {
    const unrevealed = run([{ type: "pin", item: A }, answerA])
    assert.strictEqual(unrevealed.reviewed, 0)
    const twice = run([...open(), answerA, answerA])
    assert.strictEqual(twice.reviewed, 1)
  })

  it("does not show the old note's answer after a failed answer rolls it back", () => {
    const state = run([...open(), answerA, { type: "reveal", noteId: "b" }, { type: "answerFailed", item: A }])
    const view = reviewView(state, due)
    assert.strictEqual(view.current?.note.id, "a")
    assert.isFalse(view.revealed)
    assert.strictEqual(state.reviewed, 0)
    assert.deepStrictEqual(state.inFlight, [])
  })

  it("ignores a reveal with no note, so the next note arrives unrevealed", () => {
    const state = run([
      { type: "reveal", noteId: null },
      { type: "pin", item: A }
    ])
    assert.isFalse(reviewView(state, due).revealed)
  })

  it("ignores key repeats and keys with no note", () => {
    const front = { hasNote: true, revealed: false }
    const back = { hasNote: true, revealed: true }
    assert.deepStrictEqual(reviewKeyAction({ key: " " }, front), { type: "reveal" })
    assert.deepStrictEqual(reviewKeyAction({ key: " " }, back), { type: "answer", rating: "good" })
    assert.isNull(reviewKeyAction({ key: " ", repeat: true }, back))
    assert.isNull(reviewKeyAction({ key: "Enter", repeat: true }, front))
    assert.isNull(reviewKeyAction({ key: " " }, { hasNote: false, revealed: false }))
    assert.isNull(reviewKeyAction({ key: "3" }, { hasNote: false, revealed: true }))
    assert.isNull(reviewKeyAction({ key: "3" }, front))
    assert.deepStrictEqual(reviewKeyAction({ key: "4" }, back), { type: "answer", rating: "easy" })
    assert.deepStrictEqual(reviewKeyAction({ key: "Escape" }, { hasNote: false, revealed: false }), { type: "close" })
  })

  it("retries a refetch whose due time is already past", () => {
    assert.strictEqual(waitRefetchDelay(10_000, 4_000), 6_500)
    assert.strictEqual(waitRefetchDelay(4_000, 4_000), WAIT_RETRY_MS)
    assert.strictEqual(waitRefetchDelay(1_000, 4_000), WAIT_RETRY_MS)
  })

  it("shows a message on a failed answer, and clears it on dismiss or the next answer", () => {
    const failed = run([...open(), answerA, { type: "answerFailed", item: A }])
    assert.strictEqual(failed.notice, "answerFailed")
    assert.isNull(run([{ type: "dismissNotice" }], failed).notice)
    const again = run([{ type: "reveal", noteId: "a" }, answerA], failed)
    assert.isNull(again.notice)
  })

  it("shows the leech warning only under the note on screen when it arrived", () => {
    const saved = run([...open(), answerA, { type: "answerSaved", noteId: "a", leech: true }])
    assert.isTrue(reviewView(saved, [B, C]).leech)
    assert.isFalse(reviewView(saved, [B, C]).revealed)
    const next = run(
      [
        { type: "reveal", noteId: "b" },
        { type: "answer", item: B, rating: "good", items: [B, C] }
      ],
      saved
    )
    assert.isFalse(reviewView(next, [C]).leech)
    const clean = run([...open(), answerA, { type: "answerSaved", noteId: "a", leech: false }])
    assert.isFalse(reviewView(clean, [B, C]).leech)
  })

  it("keeps the pinned note through a refetch and skips notes in flight", () => {
    const state = run([...open(), answerA])
    const refetched = [C, B]
    assert.strictEqual(reviewView(state, refetched).current?.note.id, "b")
    assert.strictEqual(reviewView(state, refetched).remaining, 2)
    const saved = run([{ type: "answerSaved", noteId: "a", leech: false }], state)
    assert.deepStrictEqual(saved.inFlight, [])
    assert.strictEqual(reviewView(saved, refetched).total, 3)
  })
})
