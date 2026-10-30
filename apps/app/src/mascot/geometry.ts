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
  tail: "M33.3 139.9 C 30 142.1, 20.4 148, 20 152.1 C 19.7 155.8, 24.2 156.5, 28.1 156.8 C 29.6 158.1, 30.1 160.3, 34.2 159.7 C 36.6 159.4, 43.4 156.5, 42.7 154.7 L 47.1 147.5 Z",
  /** Feet are round-capped strokes; the back one tucks behind the body. */
  feet: { back: "M136.7 175 H 147.7", front: "M88.4 176.9 H 99.4", width: 6.8 },
  tuft: [
    { cx: 91.3, cy: 31.4, r: 8.1 },
    { cx: 105.3, cy: 27.8, r: 8.1 },
    { cx: 119.6, cy: 30, r: 8.1 }
  ],
  body: "M111.2 27 C 149 28.4, 165.7 48.6, 176.4 82.7 C 186.8 115.2, 190.3 147, 158.2 166.3 C 131.2 182.5, 89.7 178.3, 60.4 167.7 C 24.5 154.7, 30.8 113.8, 39.6 80.2 C 49.2 43.4, 73.6 25.5, 111.2 27 Z",
  /** The shadowed underside. */
  shade:
    "M181.8 136.9 C 178.6 148.2, 171.5 158.3, 158.2 166.3 C 131.2 182.5, 89.7 178.3, 60.4 167.7 C 35.9 158.8, 31.1 136.9, 33.2 113.2 C 48.7 133, 76.4 162.2, 118.6 162.2 C 143.3 162.2, 167.1 156.3, 181.8 136.9 Z",
  /** Drawn in translucent white so it pales the body and the shade alike. */
  belly:
    "M75 172.1 A 49.7 42.1 -39.5 0 1 168.5 158.6 C 165.6 161.3, 162.2 163.9, 158.2 166.3 C 135.4 179.9, 102.3 179.1, 75 172.1 Z",
  wing: "M46.3 80.6 C 66.1 77.4, 77.9 100.1, 64.8 120.8 C 53.9 138.1, 16.1 144.8, 16.3 127.5 C 16.4 113.9, 31.6 83, 46.3 80.6 Z",
  /** Wing raised for celebrations. */
  wingUp:
    "M71.4 78.8 C 72.8 98.8, 49.3 108.6, 29.8 93.8 C 13.5 81.4, 10.1 43.1, 27.3 44.8 C 40.9 46.1, 70.4 64, 71.4 78.8 Z",
  cheeks: [
    { cx: 90.2, cy: 88.6, rx: 8.8, ry: 6.8 },
    { cx: 163.7, cy: 88.5, rx: 8.8, ry: 6.8 }
  ],
  eyes: [
    { cx: 103.2, cy: 76.6, rx: 6.7, ry: 9.4 },
    { cx: 151.4, cy: 76.6, rx: 6.7, ry: 9.4 }
  ],
  /** Catchlight, offset from each eye's centre. */
  catchlight: { dx: -2.1, dy: -4, r: 2.4 },
  beak: "M129.4 75.8 C 131.4 75.7, 136.5 79.5, 138.4 82.9 C 139.2 84.3, 132.6 88.9, 129.4 88.8 C 126.7 88.6, 119.3 84.7, 120.2 82.8 C 121.9 79.3, 128.1 75.9, 129.4 75.8 Z"
} as const

export type Mood = "curious" | "happy" | "thinking" | "sleepy" | "celebrate" | "oops"
