/** A box in the tooltip layer's own coordinates. */
export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

/** The space between the bubble and what it explains; the arrow sits in it. */
export const TOOLTIP_GAP = 9
/** How close the bubble may come to the edge of the screen. */
export const TOOLTIP_MARGIN = 12
/** How close the arrow may come to the bubble's rounded corners. */
const ARROW_INSET = 16

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/** The edges of the screen's usable area: under the status bar, above the home indicator. */
export interface Insets {
  readonly top?: number
  readonly bottom?: number
}

/**
 * Where a tooltip's bubble goes: centred above what it explains, pushed sideways to stay on screen,
 * and below instead if there is no room above (counting `insets`). If neither side has room it
 * takes the roomier one. `arrow` is the arrow's centre, measured from the bubble's left edge: it
 * keeps pointing at the anchor when the bubble has been pushed sideways, and stays off the bubble's
 * rounded corners, the bubble giving up some of its margin when the anchor hugs the screen's edge.
 */
export const placeTooltip = (anchor: Box, bubble: Size, layer: Size, { top = 0, bottom = 0 }: Insets = {}) => {
  const centre = anchor.x + anchor.width / 2
  // Room to slide towards an edge so the arrow can reach an anchor that is close to it.
  const leftmost = Math.min(TOOLTIP_MARGIN, Math.max(0, centre - ARROW_INSET))
  const rightmost = Math.max(
    layer.width - TOOLTIP_MARGIN - bubble.width,
    Math.min(layer.width - bubble.width, centre + ARROW_INSET - bubble.width)
  )
  const left = clamp(centre - bubble.width / 2, leftmost, Math.max(leftmost, rightmost))
  const above = anchor.y - TOOLTIP_GAP - bubble.height
  const below = anchor.y + anchor.height + TOOLTIP_GAP
  const roomAbove = anchor.y - TOOLTIP_GAP - (top + TOOLTIP_MARGIN)
  const roomBelow = layer.height - bottom - TOOLTIP_MARGIN - below
  const placement: "above" | "below" =
    roomAbove >= bubble.height || (roomBelow < bubble.height && roomAbove >= roomBelow) ? "above" : "below"
  // Off the corners if it can be, but never off the anchor.
  const arrow = clamp(
    clamp(centre - left, ARROW_INSET, Math.max(ARROW_INSET, bubble.width - ARROW_INSET)),
    anchor.x - left,
    anchor.x + anchor.width - left
  )
  return { left, top: placement === "above" ? above : below, placement, arrow }
}
