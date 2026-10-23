/**
 * Kotori, a shima enaga (シマエナガ): a round white snowball of a bird with bead
 * eyes, a tiny beak, dark wings with a rosy shoulder and a long tail. Geometry
 * lives here so the animated component and the icon renderer share it.
 * Coordinates are in a 200×200 box.
 */
export const palette = {
  ink: "#2B2622",
  white: "#FFFFFF",
  cream: "#FBF7F2",
  shade: "#EEE6DC",
  outline: "#E3D9CD",
  rose: "#DFA59B",
  blush: "#F4AFA6",
  sky: "#9CC5E8"
}

export const shapes = {
  tail: "M134 140 C 157 151, 176 167, 195 191 C 189 195, 181 194, 176 189 C 161 171, 146 160, 126 150 Z",
  tailHighlight: "M139 147 C 158 157, 174 171, 188 188",
  feet: "M80 166 l -4 11 M 80 166 l 3 11 M 104 166 l -3 11 M 104 166 l 4 11",
  body: { cx: 94, cy: 104, rx: 72, ry: 65 },
  tuft: "M76 44 q 6 -11 12 -2 q 6 -11 12 0",
  wing: "M134 97 C 151 103, 159 124, 150 146 C 138 143, 130 129, 130 113 C 130 106, 131 100, 134 97 Z",
  wingShoulder: "M134 100 C 142 103, 149 108, 152 116 C 145 116, 137 112, 132 106 Z",
  wingEdge: "M146 135 C 143 139, 139 139, 135 135",
  /** Wing raised for celebrations. */
  wingUp: "M136 106 C 148 92, 166 84, 182 88 C 176 102, 160 115, 139 121 C 133 117, 132 111, 136 106 Z",
  wingUpShoulder: "M138 106 C 145 98, 154 93, 162 91 C 157 99, 148 106, 137 111 Z",
  cheeks: [
    { cx: 54, cy: 113, rx: 11, ry: 7 },
    { cx: 115, cy: 113, rx: 10, ry: 7 }
  ],
  eyes: [
    { cx: 67, cy: 99 },
    { cx: 103, cy: 99 }
  ],
  beak: "M80 109 L 90 109 L 85 116 Z"
} as const

/** Shift that centres the whole bird, tail included, in its 200×200 box. */
export const centering = { x: -9, y: -14 }

export type Mood = "curious" | "happy" | "thinking" | "sleepy" | "celebrate" | "oops"
