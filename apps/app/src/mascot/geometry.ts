/**
 * Kotori, a shima enaga (シマエナガ). Geometry lives here so the animated
 * component and the icon renderer share it.
 * Coordinates are in a 200×200 box.
 */
export const palette = {
  ink: "#2B2622",
  white: "#FFFFFF",
  cream: "#F5F1E8",
  shade: "#DFD1C4",
  blush: "#F49D94",
  sky: "#94C1E2"
}

/** Kotori in three-quarter view, facing left. */
export const shapes = {
  /** The tail's root runs on under the body, along its edges, so it stays joined as the tail swings. */
  tail: "M156.7 133.3 L 166.7 139.9 C 170 142.1, 179.6 148, 180 152.1 C 180.3 155.8, 175.8 156.5, 171.9 156.8 C 170.4 158.1, 169.9 160.3, 165.8 159.7 C 163.4 159.4, 156.6 156.5, 157.3 154.7 L 158.7 151.1 L 148 146 Z",
  /** Feet are round-capped strokes; the back one tucks behind the body. */
  feet: { back: "M52.3 175 H 63.3", front: "M100.6 176.9 H 111.6", width: 6.8 },
  tuft: [
    { cx: 80.4, cy: 30, r: 8.1 },
    { cx: 94.7, cy: 27.8, r: 8.1 },
    { cx: 108.7, cy: 31.4, r: 8.1 }
  ],
  body: "M88.8 27 C 51 28.4, 34.3 48.6, 23.6 82.7 C 13.2 115.2, 9.7 147, 41.8 166.3 C 68.8 182.5, 110.3 178.3, 139.6 167.7 C 175.5 154.7, 169.2 113.8, 160.4 80.2 C 150.8 43.4, 126.4 25.5, 88.8 27 Z",
  /** The shadowed underside. */
  shade:
    "M18.2 136.9 C 21.4 148.2, 28.5 158.3, 41.8 166.3 C 68.8 182.5, 110.3 178.3, 139.6 167.7 C 164.1 158.8, 168.9 136.9, 166.8 113.2 C 151.3 133, 123.6 162.2, 81.4 162.2 C 56.7 162.2, 32.9 156.3, 18.2 136.9 Z",
  /** Drawn in translucent white so it pales the body and the shade alike. */
  belly:
    "M125 172.1 A 49.7 42.1 39.5 0 0 31.5 158.6 C 34.4 161.3, 37.8 163.9, 41.8 166.3 C 64.6 179.9, 97.7 179.1, 125 172.1 Z",
  wing: "M153.7 80.6 C 133.9 77.4, 122.1 100.1, 135.2 120.8 C 146.1 138.1, 183.9 144.8, 183.7 127.5 C 183.6 113.9, 168.4 83, 153.7 80.6 Z",
  cheeks: [
    { cx: 36.3, cy: 88.5, rx: 8.8, ry: 6.8 },
    { cx: 109.8, cy: 88.6, rx: 8.8, ry: 6.8 }
  ],
  eyes: [
    { cx: 48.6, cy: 76.6, rx: 6.7, ry: 9.4 },
    { cx: 96.8, cy: 76.6, rx: 6.7, ry: 9.4 }
  ],
  /** Catchlight, offset from each eye's centre. */
  catchlight: { dx: 2.1, dy: -4, r: 2.4 },
  beak: "M70.6 75.8 C 68.6 75.7, 63.5 79.5, 61.6 82.9 C 60.8 84.3, 67.4 88.9, 70.6 88.8 C 73.3 88.6, 80.7 84.7, 79.8 82.8 C 78.1 79.3, 71.9 75.9, 70.6 75.8 Z"
} as const

/**
 * The parts that move, and the point each one turns and scales about. `bird`
 * is the whole of Kotori, standing where its feet meet the ground; `face`
 * carries the cheeks, beak and eyes, and `eyes` moves within it. As the eyes
 * fade, shut eyes show in their place.
 *
 * The front view (see `frontMoods`) adds its own parts: `sideWing` is its
 * left wing as `frontShapes` draws it, `chinWing` the same wing raised to the
 * chin, and the thought bubble's `trail0` and `trail1` puffs and `bubble`,
 * which carries `dot0` to `dot2`. It reuses `bird`, and `eyes` only to blink,
 * which fades them without moving them.
 */
export const joints = {
  bird: { x: 92, y: 180 },
  tail: { x: 162, y: 147.3 },
  backFoot: { x: 57.8, y: 175 },
  frontFoot: { x: 106.1, y: 176.9 },
  wing: { x: 140.3, y: 91.2 },
  face: { x: 72.7, y: 82 },
  eyes: { x: 72.7, y: 76.6 },
  sideWing: { x: 30, y: 113 },
  /** The shoulder, on the wing's outer edge. */
  chinWing: { x: 24, y: 118 },
  trail0: { x: 119, y: 15 },
  trail1: { x: 127, y: 2 },
  /** The bubble's lower left, nearest the trail, which it grows out of. */
  bubble: { x: 116, y: -14 },
  dot0: { x: 126, y: -33 },
  dot1: { x: 140, y: -33 },
  dot2: { x: 154, y: -33 }
} as const

/** Kotori facing the viewer, symmetric about x = 100. */
export const frontShapes = {
  /** Wings peek out from behind the body on either side. */
  wings: [
    "M36.1 83 C 27.1 88.5, 20.2 105.5, 20.2 120.7 C 20.2 131.4, 24 144.5, 30.1 142.9 C 37.1 130.9, 44.1 105, 36.1 83 Z",
    "M163.9 83 C 155.9 105, 162.9 130.9, 169.9 142.9 C 176 144.5, 179.8 131.4, 179.8 120.7 C 179.8 105.5, 172.9 88.5, 163.9 83 Z"
  ],
  tuft: [
    { cx: 86.4, cy: 30.9, r: 8.5 },
    { cx: 100, cy: 28.1, r: 8.5 },
    { cx: 113.6, cy: 30.9, r: 8.5 }
  ],
  body: "M100 26.1 C 61.7 26.1, 41 50.5, 35.8 76.4 C 32.4 93.6, 26.4 102.6, 26.4 123.8 C 26.4 161.6, 59 177.8, 100 177.8 C 141 177.8, 173.6 161.6, 173.6 123.8 C 173.6 102.6, 167.6 93.6, 164.2 76.4 C 159 50.5, 138.3 26.1, 100 26.1 Z",
  /** The shadowed lower sides. */
  shade:
    "M28.4 104.5 C 27.2 110, 26.4 116.1, 26.4 123.8 C 26.4 161.6, 59 177.8, 100 177.8 C 141 177.8, 173.6 161.6, 173.6 123.8 C 173.6 116.1, 172.8 110, 171.6 104.5 C 166.9 142.2, 139.7 161.8, 100 161.8 C 60.3 161.8, 33.1 142.2, 28.4 104.5 Z",
  /** Drawn in translucent white so it pales the body and the shade alike. */
  belly:
    "M137.9 172 A 41.8 36.8 0 1 0 62.1 172 C 73.2 175.9, 86.1 177.8, 100 177.8 C 113.9 177.8, 126.8 175.9, 137.9 172 Z",
  /** Feet are round-capped strokes, both in front of the body. */
  feet: { left: "M70.4 176.8 H 81.4", right: "M118.6 176.8 H 129.6", width: 6.8 },
  cheeks: [
    { cx: 61.9, cy: 88.3, rx: 8.8, ry: 6.8 },
    { cx: 138.1, cy: 88.3, rx: 8.8, ry: 6.8 }
  ],
  eyes: [
    { cx: 74.9, cy: 76.3, rx: 6.7, ry: 9.4 },
    { cx: 125.1, cy: 76.3, rx: 6.7, ry: 9.4 }
  ],
  /** Catchlight, offset from each eye's centre. */
  catchlight: { dx: 2, dy: -3.8, r: 2.4 },
  beak: "M100 75.6 C 97.1 75.6, 90.9 81.2, 90.4 83.1 C 90.2 84.2, 98 88.5, 100 88.5 C 102 88.5, 109.8 84.2, 109.6 83.1 C 109.1 81.2, 102.9 75.6, 100 75.6 Z"
} as const

/**
 * Kotori thinking: the front view with its left wing raised to its chin, and
 * a thought bubble rising from the top of its head. The bubble reaches above
 * the box, into `headroom`.
 */
export const thinkingShapes = {
  /** A crescent drawn over the body and cheek, its tip under the beak. Shown in place of `frontShapes.wings[0]`. */
  chinWing:
    "M89 89.5 C 92 95, 88 112, 80 120.3 C 72 131, 58 143, 45 143.5 C 33 144, 22 134, 21 120 C 20 108, 24 97, 33 93 C 40 90, 47 97, 58 101.5 C 70 106, 82 100, 89 89.5 Z",
  /** Puffs between the head and the bubble, smallest first. */
  trail: [
    { cx: 119, cy: 15, r: 3.4 },
    { cx: 127, cy: 2, r: 5 }
  ],
  /** A cloud of eight bumps, symmetric about x = 140, reaching y = -58. */
  bubble:
    "M114 -14 A 11 11 0 0 1 103 -32 A 11.5 11.5 0 0 1 118 -48 A 12.5 12.5 0 0 1 140 -54 A 12.5 12.5 0 0 1 162 -48 A 11.5 11.5 0 0 1 177 -32 A 11 11 0 0 1 166 -14 A 14 14 0 0 1 140 -10 A 14 14 0 0 1 114 -14 Z",
  /** The dots of an ellipsis inside the bubble, left to right. */
  dots: [
    { cx: 126, cy: -33, r: 4 },
    { cx: 140, cy: -33, r: 4 },
    { cx: 154, cy: -33, r: 4 }
  ],
  /** How far above the box the bubble reaches, with room for it to swell as it appears and to bob. */
  headroom: 66
} as const

export type Mood = "curious" | "happy" | "thinking" | "sleepy" | "celebrate" | "oops"

/** Moods Kotori takes facing the viewer. It shows the rest in three-quarter view. */
export const frontMoods: ReadonlySet<Mood> = new Set(["thinking"])

/** How far above the box Kotori's drawing reaches in `mood`, in box units. */
export const headroom = (mood: Mood) => (mood === "thinking" ? thinkingShapes.headroom : 0)
