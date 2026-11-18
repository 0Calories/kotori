import { assert, describe, it } from "vitest"
import { gatherDueNotes } from "../src/features/study/gather.ts"

const note = (id: string, due = 0) => ({ id, due: new Date(due) })

describe("gathering the due notes", () => {
  it("puts a learning note first once it is due, behind the rest until then", () => {
    const learning = [note("l1", 1_500)]
    const reviews = [note("r1"), note("r2")]
    assert.deepStrictEqual(
      gatherDueNotes(learning, reviews, [], new Date(1_000)).map((n) => n.id),
      ["r1", "r2", "l1"]
    )
    assert.deepStrictEqual(
      gatherDueNotes(learning, reviews, [], new Date(1_500)).map((n) => n.id),
      ["l1", "r1", "r2"]
    )
  })

  it("re-spaces new notes after a review is answered, so the old second note is no longer next", () => {
    const reviews = [note("r1"), note("r2"), note("r3")]
    const fresh = [note("n1"), note("n2")]
    const before = gatherDueNotes([], reviews, fresh, new Date(1_000)).map((n) => n.id)
    assert.deepStrictEqual(before, ["r1", "n1", "r2", "n2", "r3"])

    // r1 has been answered and is no longer due. Gathering again builds a new order.
    const after = gatherDueNotes([], reviews.slice(1), fresh, new Date(1_000)).map((n) => n.id)
    assert.deepStrictEqual(after, ["r2", "n1", "r3", "n2"])
    assert.notStrictEqual(after[0], before[1])
  })
})
