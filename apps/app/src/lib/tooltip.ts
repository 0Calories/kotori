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

/**
 * Where a tooltip bubble goes: centred above what it explains, pushed sideways to stay on screen,
 * and below instead when there is no room above (`top` is where the screen's usable area starts,
 * under the status bar). `arrow` is the arrow's centre, measured from the bubble's left edge: it
 * keeps pointing at the anchor when the bubble has been pushed sideways.
 */
export const placeTooltip = (anchor: Box, bubble: Size, layer: Size, top = 0) => {
  const centre = anchor.x + anchor.width / 2
  const left = clamp(
    centre - bubble.width / 2,
    TOOLTIP_MARGIN,
    Math.max(TOOLTIP_MARGIN, layer.width - TOOLTIP_MARGIN - bubble.width)
  )
  const above = anchor.y - TOOLTIP_GAP - bubble.height
  const placement: "above" | "below" = above >= top + TOOLTIP_MARGIN ? "above" : "below"
  return {
    left,
    top: placement === "above" ? above : anchor.y + anchor.height + TOOLTIP_GAP,
    placement,
    arrow: clamp(centre - left, ARROW_INSET, Math.max(ARROW_INSET, bubble.width - ARROW_INSET))
  }
}
