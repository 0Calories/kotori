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

export const shapes = {
  tail: "M166.7 139.9 C 170 142.1, 179.6 148, 180 152.1 C 180.3 155.8, 175.8 156.5, 171.9 156.8 C 170.4 158.1, 169.9 160.3, 165.8 159.7 C 163.4 159.4, 156.6 156.5, 157.3 154.7 L 152.9 147.5 Z",
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
  /** Wing raised for celebrations. */
  wingUp:
    "M128.6 78.8 C 127.2 98.8, 150.7 108.6, 170.2 93.8 C 186.5 81.4, 189.9 43.1, 172.7 44.8 C 159.1 46.1, 129.6 64, 128.6 78.8 Z",
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

export type Mood = "curious" | "happy" | "thinking" | "sleepy" | "celebrate" | "oops"
