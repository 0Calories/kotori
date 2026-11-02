import { assert, describe, it } from "vitest"
import { gatherQueue } from "../src/features/study/gather.ts"

const card = (id: string, due = 0) => ({ id, due: new Date(due) })

describe("gathering the review queue", () => {
  it("puts a learning card first once it is due, behind the rest until then", () => {
    const learning = [card("l1", 1_500)]
    const reviews = [card("r1"), card("r2")]
    assert.deepStrictEqual(
      gatherQueue(learning, reviews, [], new Date(1_000)).map((c) => c.id),
      ["r1", "r2", "l1"]
    )
    assert.deepStrictEqual(
      gatherQueue(learning, reviews, [], new Date(1_500)).map((c) => c.id),
      ["l1", "r1", "r2"]
    )
  })

  it("re-spaces new cards after a review is answered, so the old second card is no longer next", () => {
    const reviews = [card("r1"), card("r2"), card("r3")]
    const fresh = [card("n1"), card("n2")]
    const before = gatherQueue([], reviews, fresh, new Date(1_000)).map((c) => c.id)
    assert.deepStrictEqual(before, ["r1", "n1", "r2", "n2", "r3"])

    // r1 has been answered and left the review queue. Gathering again builds a new order.
    const after = gatherQueue([], reviews.slice(1), fresh, new Date(1_000)).map((c) => c.id)
    assert.deepStrictEqual(after, ["r2", "n1", "r3", "n2"])
    assert.notStrictEqual(after[0], before[1])
  })
})
