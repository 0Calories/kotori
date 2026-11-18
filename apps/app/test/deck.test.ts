import type { DueNotes, Note, NoteId, ReviewItem, StudyStats } from "@kotori/contracts"
import { assert, describe, it } from "vitest"
import { dueWithoutNote, statsWithoutNote, withoutNote } from "../src/lib/deck.ts"
import { savedWord } from "./notes.fixtures.ts"

const noteId = (id: string) => id as NoteId

const phrase = (id: string, retentionStage: Note["retentionStage"], interval = 0): Note =>
  savedWord(id, { headword: id }, { retentionStage, interval })

const item = (id: string, retentionStage: Note["retentionStage"], interval = 0): ReviewItem => ({
  note: phrase(id, retentionStage, interval),
  labels: { again: "1m", hard: "1d", good: "4d", easy: "7d" }
})

const dueNotes = (items: ReadonlyArray<ReviewItem>, counts = { new: 1, learning: 1, review: 1 }): DueNotes => ({
  items,
  counts,
  all: items.map(({ note }) => ({ id: note.id, retentionStage: note.retentionStage })),
  nextDue: new Date(50)
})

const stats = (over: Partial<StudyStats> = {}): StudyStats => ({
  due: { new: 2, learning: 1, review: 3 },
  reviewedToday: 4,
  streak: 5,
  notes: 4,
  unseen: 2,
  young: 1,
  mature: 1,
  retention: 0.8,
  forecast: [1, 0, 2, 0, 0, 0, 0],
  ...over
})

describe("removing a saved note from the cached deck", () => {
  const saved = phrase("n1", "new")
  const other = phrase("n2", "review", 30)

  it("drops that note and leaves the rest of the deck", () => {
    assert.deepStrictEqual(
      withoutNote([saved, other], noteId("n1")).map((note) => note.id),
      [noteId("n2")]
    )
    assert.strictEqual(withoutNote([saved], noteId("missing")).length, 1)
  })

  it("updates counts for a due note beyond the first 100 items", () => {
    const eligible = Array.from({ length: 200 }, (_, i) => item(`n${i}`, "review", 30))
    const before = {
      ...dueNotes(eligible.slice(0, 100), { new: 0, learning: 0, review: 200 }),
      all: eligible.map(({ note }) => ({ id: note.id, retentionStage: note.retentionStage }))
    }
    const removed = phrase("n150", "review", 30)
    const after = dueWithoutNote(before, removed.id)
    assert.strictEqual(after.items.length, 100)
    assert.deepStrictEqual(after.counts, { new: 0, learning: 0, review: 199 })
    assert.strictEqual(after.all.length, 199)
    assert.isFalse(after.all.some((note) => note.id === removed.id))
    const totals = statsWithoutNote(stats({ due: before.counts, notes: 200 }), removed, before)
    assert.deepStrictEqual(totals.due, after.counts)
    assert.strictEqual(totals.notes, 199)
    // A duplicate success cannot subtract this note a second time.
    assert.deepStrictEqual(dueWithoutNote(after, removed.id).counts, after.counts)
  })

  it("drops the note from the due notes and no one else's", () => {
    const before = dueNotes([item("n1", "learning"), item("n2", "review", 30)], { new: 0, learning: 1, review: 1 })
    const after = dueWithoutNote(before, noteId("n1"))
    assert.deepStrictEqual(
      after.items.map((row) => row.note.id),
      [noteId("n2")]
    )
    assert.deepStrictEqual(after.counts, { new: 0, learning: 0, review: 1 })
    assert.deepStrictEqual(after.nextDue, new Date(50))
  })

  it("does not lower due counts when the note was not due", () => {
    const later = phrase("n1", "review", 40)
    const before = dueNotes([item("n2", "new")], { new: 1, learning: 0, review: 0 })
    const after = statsWithoutNote(stats({ due: { new: 1, learning: 0, review: 4 } }), later, before)
    assert.deepStrictEqual(after.due, { new: 1, learning: 0, review: 4 })
    assert.strictEqual(after.notes, 3)
    assert.strictEqual(after.mature, 0)
    assert.strictEqual(after.young, 1)
    // Review history is reconciled by the refetch, not guessed here.
    assert.strictEqual(after.reviewedToday, 4)
    assert.strictEqual(after.streak, 5)
    assert.strictEqual(after.retention, 0.8)
    assert.deepStrictEqual(after.forecast, [1, 0, 2, 0, 0, 0, 0])
  })

  it("moves a new, young or mature note out of the totals", () => {
    const totals = stats({ notes: 4, unseen: 1, young: 2, mature: 1 })
    const split = (note: Note) => {
      const after = statsWithoutNote(totals, note, undefined)
      return [after.notes, after.unseen, after.young, after.mature]
    }
    assert.deepStrictEqual(split(phrase("a", "new")), [3, 0, 2, 1])
    assert.deepStrictEqual(split(phrase("b", "learning")), [3, 1, 1, 1])
    assert.deepStrictEqual(split(phrase("c", "relearning", 30)), [3, 1, 1, 1])
    assert.deepStrictEqual(split(phrase("d", "review", 20)), [3, 1, 1, 1])
    assert.deepStrictEqual(split(phrase("e", "review", 21)), [3, 1, 2, 0])
    // Without the due notes, the due counts are left for the refetch.
    assert.deepStrictEqual(statsWithoutNote(totals, phrase("a", "new"), undefined).due, totals.due)
  })
})
