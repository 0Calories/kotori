import type { CardId, CardSummary, Note, NoteId, ReviewItem, ReviewQueue, StudyStats } from "@kotori/domain"
import { assert, describe, it } from "vitest"
import { queueWithoutNote, statsWithoutNote, withoutNote } from "../src/lib/collection.ts"

const noteId = (id: string) => id as NoteId

const card = (id: string, queue: CardSummary["queue"], interval = 0): CardSummary => ({
  id: id as CardId,
  template: "recognize",
  queue,
  due: 0,
  interval,
  leech: false
})

const phrase = (id: string, cards: ReadonlyArray<CardSummary>): Note => ({
  id: noteId(id),
  createdAt: 0,
  content: {
    kind: "phrase",
    text: id,
    furigana: null,
    meaning: id,
    note: null,
    register: null,
    source: "manual"
  },
  cards
})

const item = (id: string, note: string, queue: CardSummary["queue"], interval = 0): ReviewItem => ({
  card: {
    ...card(id, queue, interval),
    noteId: noteId(note),
    ease: 2.5,
    reps: 1,
    lapses: 0,
    content: phrase(note, []).content
  },
  labels: { again: "1m", hard: "1d", good: "4d", easy: "7d" }
})

const queue = (items: ReadonlyArray<ReviewItem>, counts = { new: 1, learning: 1, review: 1 }): ReviewQueue => ({
  items,
  counts,
  nextDue: 50
})

const stats = (over: Partial<StudyStats> = {}): StudyStats => ({
  due: { new: 2, learning: 1, review: 3 },
  reviewedToday: 4,
  streak: 5,
  notes: 3,
  cards: 4,
  unseen: 2,
  young: 1,
  mature: 1,
  retention: 0.8,
  forecast: [1, 0, 2, 0, 0, 0, 0],
  ...over
})

describe("removing a saved note from the cached collection", () => {
  const saved = phrase("n1", [card("c1", "new")])
  const other = phrase("n2", [card("c2", "review", 30)])

  it("drops that note and leaves the rest of the collection", () => {
    assert.deepStrictEqual(
      withoutNote([saved, other], noteId("n1")).map((note) => note.id),
      [noteId("n2")]
    )
    assert.strictEqual(withoutNote([saved], noteId("missing")).length, 1)
  })

  it("drops the note's due cards and no one else's", () => {
    const before = queue([
      item("c-new", "n1", "new"),
      item("c-learn", "n1", "learning"),
      item("c-review", "n2", "review", 30)
    ])
    const after = queueWithoutNote(before, noteId("n1"))
    assert.deepStrictEqual(
      after.items.map((row) => row.card.id),
      ["c-review"]
    )
    assert.deepStrictEqual(after.counts, { new: 0, learning: 0, review: 1 })
    assert.strictEqual(after.nextDue, 50)
  })

  it("does not lower due counts for a card that was not in the queue", () => {
    const later = phrase("n1", [card("c-later", "review", 40)])
    const before = queue([item("c-other", "n2", "new")], { new: 1, learning: 0, review: 0 })
    const after = statsWithoutNote(stats({ due: { new: 1, learning: 0, review: 4 } }), later, before)
    assert.deepStrictEqual(after.due, { new: 1, learning: 0, review: 4 })
    assert.strictEqual(after.notes, 2)
    assert.strictEqual(after.cards, 3)
    assert.strictEqual(after.mature, 0)
    assert.strictEqual(after.young, 1)
    // Review history is reconciled by the refetch, not guessed here.
    assert.strictEqual(after.reviewedToday, 4)
    assert.strictEqual(after.streak, 5)
    assert.strictEqual(after.retention, 0.8)
    assert.deepStrictEqual(after.forecast, [1, 0, 2, 0, 0, 0, 0])
  })

  it("moves new, young and mature cards out of the totals", () => {
    const mixed = phrase("n1", [
      card("a", "new"),
      card("b", "learning"),
      card("c", "review", 21),
      card("d", "relearning")
    ])
    const before = queue([item("a", "n1", "new"), item("b", "n1", "learning"), item("c", "n1", "review", 21)], {
      new: 1,
      learning: 1,
      review: 1
    })
    const after = statsWithoutNote(stats({ notes: 1, cards: 4, unseen: 1, young: 2, mature: 1 }), mixed, before)
    assert.deepStrictEqual(after.due, { new: 1, learning: 0, review: 2 })
    assert.strictEqual(after.notes, 0)
    assert.strictEqual(after.cards, 0)
    assert.strictEqual(after.unseen, 0)
    assert.strictEqual(after.young, 0)
    assert.strictEqual(after.mature, 0)
  })
})
