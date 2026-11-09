import type { CardId, EntryId, NoteId, ReviewItem } from "@kotori/contracts"
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
  card: {
    id: id as CardId,
    noteId: "note" as NoteId,
    template: "recognize",
    queue: "review",
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
const queue = [A, B, C]
const open = (): ReviewSessionEvent[] => [
  { type: "pin", item: A },
  { type: "reveal", cardId: "a" }
]
const answerA: ReviewSessionEvent = { type: "answer", item: A, rating: "good", items: queue }

describe("review session reducer", () => {
  it("advances to the next card unrevealed and counts the answer", () => {
    const state = run([...open(), answerA])
    const view = reviewView(state, queue)
    assert.strictEqual(view.current?.card.id, "b")
    assert.isFalse(view.revealed)
    assert.strictEqual(state.reviewed, 1)
    assert.deepStrictEqual(state.inFlight, ["a"])
  })

  it("does not answer a card that isn't revealed, or answer twice", () => {
    const unrevealed = run([{ type: "pin", item: A }, answerA])
    assert.strictEqual(unrevealed.reviewed, 0)
    const twice = run([...open(), answerA, answerA])
    assert.strictEqual(twice.reviewed, 1)
  })

  it("does not show the old card's answer after a failed answer rolls it back (bug 1)", () => {
    const state = run([...open(), answerA, { type: "reveal", cardId: "b" }, { type: "answerFailed", item: A }])
    const view = reviewView(state, queue)
    assert.strictEqual(view.current?.card.id, "a")
    assert.isFalse(view.revealed)
    assert.strictEqual(state.reviewed, 0)
    assert.deepStrictEqual(state.inFlight, [])
  })

  it("ignores a reveal with no card, so the next card arrives unrevealed (bug 2)", () => {
    const state = run([
      { type: "reveal", cardId: null },
      { type: "pin", item: A }
    ])
    assert.isFalse(reviewView(state, queue).revealed)
  })

  it("ignores key repeats and keys with no card (bug 3)", () => {
    const front = { hasCard: true, revealed: false }
    const back = { hasCard: true, revealed: true }
    assert.deepStrictEqual(reviewKeyAction({ key: " " }, front), { type: "reveal" })
    assert.deepStrictEqual(reviewKeyAction({ key: " " }, back), { type: "answer", rating: "good" })
    assert.isNull(reviewKeyAction({ key: " ", repeat: true }, back))
    assert.isNull(reviewKeyAction({ key: "Enter", repeat: true }, front))
    assert.isNull(reviewKeyAction({ key: " " }, { hasCard: false, revealed: false }))
    assert.isNull(reviewKeyAction({ key: "3" }, { hasCard: false, revealed: true }))
    assert.isNull(reviewKeyAction({ key: "3" }, front))
    assert.deepStrictEqual(reviewKeyAction({ key: "4" }, back), { type: "answer", rating: "easy" })
    assert.deepStrictEqual(reviewKeyAction({ key: "Escape" }, { hasCard: false, revealed: false }), { type: "close" })
  })

  it("retries a refetch whose due time is already past (bug 4)", () => {
    assert.strictEqual(waitRefetchDelay(10_000, 4_000), 6_500)
    assert.strictEqual(waitRefetchDelay(4_000, 4_000), WAIT_RETRY_MS)
    assert.strictEqual(waitRefetchDelay(1_000, 4_000), WAIT_RETRY_MS)
  })

  it("shows a message on a failed answer, and clears it on dismiss or the next answer (bug 5)", () => {
    const failed = run([...open(), answerA, { type: "answerFailed", item: A }])
    assert.strictEqual(failed.notice, "answerFailed")
    assert.isNull(run([{ type: "dismissNotice" }], failed).notice)
    const again = run([{ type: "reveal", cardId: "a" }, answerA], failed)
    assert.isNull(again.notice)
  })

  it("shows the leech warning only under the card on screen when it arrived (bug 5)", () => {
    const saved = run([...open(), answerA, { type: "answerSaved", cardId: "a", leech: true }])
    assert.isTrue(reviewView(saved, [B, C]).leech)
    assert.isFalse(reviewView(saved, [B, C]).revealed)
    const next = run(
      [
        { type: "reveal", cardId: "b" },
        { type: "answer", item: B, rating: "good", items: [B, C] }
      ],
      saved
    )
    assert.isFalse(reviewView(next, [C]).leech)
    const clean = run([...open(), answerA, { type: "answerSaved", cardId: "a", leech: false }])
    assert.isFalse(reviewView(clean, [B, C]).leech)
  })

  it("keeps the pinned card through a refetch and skips cards in flight", () => {
    const state = run([...open(), answerA])
    const refetched = [C, B]
    assert.strictEqual(reviewView(state, refetched).current?.card.id, "b")
    assert.strictEqual(reviewView(state, refetched).remaining, 2)
    const saved = run([{ type: "answerSaved", cardId: "a", leech: false }], state)
    assert.deepStrictEqual(saved.inFlight, [])
    assert.strictEqual(reviewView(saved, refetched).total, 3)
  })
})
