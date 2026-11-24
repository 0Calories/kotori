import { assert, describe, it } from "vitest"
import { placeTooltip, TOOLTIP_GAP, TOOLTIP_MARGIN } from "../src/lib/tooltip.ts"

const layer = { width: 400, height: 800 }
const bubble = { width: 200, height: 40 }

describe("placing a tooltip", () => {
  it("centres it above what it explains, the arrow in the middle", () => {
    const place = placeTooltip({ x: 180, y: 300, width: 40, height: 28 }, bubble, layer)
    assert.deepEqual(place, { left: 100, top: 300 - TOOLTIP_GAP - 40, placement: "above", arrow: 100 })
  })

  it("stays on screen beside an edge, the arrow still pointing at the anchor", () => {
    const left = placeTooltip({ x: 20, y: 300, width: 40, height: 28 }, bubble, layer)
    assert.equal(left.left, TOOLTIP_MARGIN)
    assert.equal(left.arrow, 40 - TOOLTIP_MARGIN)
    const right = placeTooltip({ x: 350, y: 300, width: 40, height: 28 }, bubble, layer)
    assert.equal(right.left, 400 - TOOLTIP_MARGIN - 200)
    assert.equal(right.left + right.arrow, 370)
  })

  it("keeps the arrow off the rounded corners, giving up some margin for an anchor by the edge", () => {
    const place = placeTooltip({ x: 8, y: 300, width: 30, height: 28 }, bubble, layer)
    assert.equal(place.arrow, 16)
    assert.equal(place.left + place.arrow, 23)
  })

  it("never lets the arrow miss the anchor, even one too close to the edge for both", () => {
    const place = placeTooltip({ x: 0, y: 300, width: 10, height: 28 }, bubble, layer)
    assert.equal(place.left, 0)
    assert.ok(place.left + place.arrow >= 0 && place.left + place.arrow <= 10)
  })

  it("goes below when there is no room above, counting the status bar", () => {
    const anchor = { x: 180, y: 70, width: 40, height: 28 }
    assert.equal(placeTooltip(anchor, bubble, layer).placement, "above")
    const below = placeTooltip(anchor, bubble, layer, { top: 44 })
    assert.equal(below.placement, "below")
    assert.equal(below.top, 70 + 28 + TOOLTIP_GAP)
  })

  it("goes below only if there is room there, otherwise to the roomier side", () => {
    const short = { width: 400, height: 140 }
    const anchor = { x: 180, y: 50, width: 40, height: 28 }
    assert.equal(placeTooltip(anchor, bubble, short, { top: 20 }).placement, "below")
    assert.equal(placeTooltip(anchor, bubble, short, { top: 20, bottom: 40 }).placement, "above")
  })

  it("pins a bubble wider than the screen to the left margin", () => {
    assert.equal(placeTooltip({ x: 180, y: 300, width: 40, height: 28 }, { width: 500, height: 40 }, layer).left, 12)
  })
})
