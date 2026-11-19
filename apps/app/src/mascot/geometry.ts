export const palette = {
  ink: "#2B2622",
  white: "#FFFFFF",
  cream: "#F5F1E8",
  shade: "#DFD1C4",
  blush: "#F49D94",
  sky: "#94C1E2",
  peach: "#F7A062",
  mint: "#96C979",
  yellow: "#F7C747",
  gold: "#F2B53A",
  skyDeep: "#76A3C3",
  rose: "#EE8A97",
  frame: "#503B2E",
  leather: "#835B2B",
  leatherDark: "#5B4727",
  paper: "#FAF4DF",
  paperEdge: "#E3D1B0",
  paperLine: "#C9B48F"
}

export const shapes = {
  tail: "M156.7 133.3 L 166.7 139.9 C 170 142.1, 179.6 148, 180 152.1 C 180.3 155.8, 175.8 156.5, 171.9 156.8 C 170.4 158.1, 169.9 160.3, 165.8 159.7 C 163.4 159.4, 156.6 156.5, 157.3 154.7 L 158.7 151.1 L 148 146 Z",
  feet: { back: "M52.3 175 H 63.3", front: "M100.6 176.9 H 111.6", width: 6.8 },
  tuft: [
    { cx: 80.4, cy: 30, r: 8.1 },
    { cx: 94.7, cy: 27.8, r: 8.1 },
    { cx: 108.7, cy: 31.4, r: 8.1 }
  ],
  body: "M88.8 27 C 51 28.4, 34.3 48.6, 23.6 82.7 C 13.2 115.2, 9.7 147, 41.8 166.3 C 68.8 182.5, 110.3 178.3, 139.6 167.7 C 175.5 154.7, 169.2 113.8, 160.4 80.2 C 150.8 43.4, 126.4 25.5, 88.8 27 Z",
  shade:
    "M18.2 136.9 C 21.4 148.2, 28.5 158.3, 41.8 166.3 C 68.8 182.5, 110.3 178.3, 139.6 167.7 C 164.1 158.8, 168.9 136.9, 166.8 113.2 C 151.3 133, 123.6 162.2, 81.4 162.2 C 56.7 162.2, 32.9 156.3, 18.2 136.9 Z",
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
  catchlight: { dx: 2.1, dy: -4, r: 2.4 },
  beak: "M70.6 75.8 C 68.6 75.7, 63.5 79.5, 61.6 82.9 C 60.8 84.3, 67.4 88.9, 70.6 88.8 C 73.3 88.6, 80.7 84.7, 79.8 82.8 C 78.1 79.3, 71.9 75.9, 70.6 75.8 Z",
  sparkles: {
    sparkle0: { cx: 25, cy: 24, r: 12 },
    sparkle1: { cx: 52, cy: 8, r: 7.5 },
    sparkle2: { cx: 6, cy: 50, r: 5.5 }
  },
  sweat: "M29 46 q 7 10 0 15 q -7 -5 0 -15 Z",
  zs: {
    z0: { d: "M25.5 47.5 H 32.5 L 25.5 54.5 H 32.5", stroke: 3.2 },
    z1: { d: "M15.5 29.5 H 24.5 L 15.5 38.5 H 24.5", stroke: 3.7 },
    z2: { d: "M9.5 9.5 H 20.5 L 9.5 20.5 H 20.5", stroke: 4.2 }
  }
} as const

const waist = 0.16

export const sparklePath = ({ cx, cy, r }: { readonly cx: number; readonly cy: number; readonly r: number }) => {
  const w = r * waist
  return `M${cx} ${cy - r} Q ${cx + w} ${cy - w} ${cx + r} ${cy} Q ${cx + w} ${cy + w} ${cx} ${cy + r} Q ${cx - w} ${cy + w} ${cx - r} ${cy} Q ${cx - w} ${cy - w} ${cx} ${cy - r} Z`
}

export type Shape = "square" | "strip" | "dot" | "curl" | "squiggle"

type Bit = { readonly d: string; readonly stroke?: number }

export const confetti: { readonly canvas: number; readonly bits: Readonly<Record<Shape, Bit>> } = {
  canvas: 22,
  bits: {
    square: { d: "M-5.5 -5.5 H 5.5 V 5.5 H -5.5 Z" },
    strip: { d: "M-3 -7 H 3 V 7 H -3 Z" },
    dot: { d: "M-5 0 A 5 5 0 0 0 5 0 A 5 5 0 0 0 -5 0 Z" },
    curl: { d: "M-7 3 Q 0 -7.5 7 3", stroke: 4 },
    squiggle: { d: "M-8.5 0 Q -4.25 -4 0 0 Q 4.25 4 8.5 0", stroke: 3.4 }
  }
}

const landing = {
  origin: { x: 100, y: 191 },
  puff: 7,
  sparks: {
    spark0: { r: 6, color: "sky" },
    spark1: { r: 8, color: "rose" },
    spark2: { r: 4, color: "skyDeep" },
    spark3: { r: 5, color: "rose" },
    spark4: { r: 4, color: "skyDeep" }
  },
  trail: { length: 40, width: 5.6 }
} as const

const hundredths = (n: number) => Math.round(n * 100) / 100

export const trailPath = ({ x, y }: { readonly x: number; readonly y: number }) => {
  const { length, width } = landing.trail
  const w = width / 2
  return `M${x} ${y - w} A ${w} ${w} 0 0 1 ${x} ${y + w} Q ${x - length * 0.45} ${y + w * 0.7} ${x - length} ${y} Q ${x - length * 0.45} ${y - w * 0.7} ${x} ${y - w} Z`
}

export const puffPath = ({ cx, cy, r }: { readonly cx: number; readonly cy: number; readonly r: number }) => {
  const at = (x: number, y: number) => `${hundredths(cx + x * r)} ${hundredths(cy + y * r)}`
  const arc = (radius: number, x: number, y: number) =>
    `A ${hundredths(radius * r)} ${hundredths(radius * r)} 0 0 1 ${at(x, y)}`
  return `M${at(-1.45, 0.55)} ${arc(0.62, -0.83, -0.48)} ${arc(0.85, 0.83, -0.48)} ${arc(0.62, 1.45, 0.55)} Q ${at(0, 0.85)} ${at(-1.45, 0.55)} Z`
}

export const joints = {
  bird: { x: 92, y: 180 },
  tail: { x: 162, y: 147.3 },
  backFoot: { x: 57.8, y: 175 },
  frontFoot: { x: 106.1, y: 176.9 },
  wing: { x: 140.3, y: 91.2 },
  face: { x: 72.7, y: 82 },
  eyes: { x: 72.7, y: 76.6 },
  sparkle0: { x: shapes.sparkles.sparkle0.cx, y: shapes.sparkles.sparkle0.cy },
  sparkle1: { x: shapes.sparkles.sparkle1.cx, y: shapes.sparkles.sparkle1.cy },
  sparkle2: { x: shapes.sparkles.sparkle2.cx, y: shapes.sparkles.sparkle2.cy },
  bubble: { x: 116, y: -14 },
  dot0: { x: 126, y: -33 },
  dot1: { x: 140, y: -33 },
  dot2: { x: 154, y: -33 },
  z0: { x: 29, y: 51 },
  z1: { x: 20, y: 34 },
  z2: { x: 15, y: 15 },
  page: { x: 100, y: 179 },
  pageWing: { x: 40.5, y: 86 },
  bookWing: { x: 159.5, y: 86 },
  glasses: { x: 100, y: 74.5 },
  book: { x: 100, y: 195 },
  cheeks: { x: 100, y: 88.8 },
  foldedWing0: { x: 36.1, y: 83 },
  foldedWing1: { x: 163.9, y: 83 },
  lookingEyes: { x: 72.7, y: 76.6 },
  puff0: landing.origin,
  puff1: landing.origin,
  spark0: landing.origin,
  spark1: landing.origin,
  spark2: landing.origin,
  spark3: landing.origin,
  spark4: landing.origin,
  trail0: landing.origin,
  trail1: landing.origin,
  trail2: landing.origin,
  trail3: landing.origin,
  trail4: landing.origin
} as const

export const frontShapes = {
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
  shade:
    "M28.4 104.5 C 27.2 110, 26.4 116.1, 26.4 123.8 C 26.4 161.6, 59 177.8, 100 177.8 C 141 177.8, 173.6 161.6, 173.6 123.8 C 173.6 116.1, 172.8 110, 171.6 104.5 C 166.9 142.2, 139.7 161.8, 100 161.8 C 60.3 161.8, 33.1 142.2, 28.4 104.5 Z",
  belly:
    "M137.9 172 A 41.8 36.8 0 1 0 62.1 172 C 73.2 175.9, 86.1 177.8, 100 177.8 C 113.9 177.8, 126.8 175.9, 137.9 172 Z",
  feet: { left: "M70.4 176.8 H 81.4", right: "M118.6 176.8 H 129.6", width: 6.8 },
  cheeks: [
    { cx: 61.9, cy: 88.3, rx: 8.8, ry: 6.8 },
    { cx: 138.1, cy: 88.3, rx: 8.8, ry: 6.8 }
  ],
  eyes: [
    { cx: 74.9, cy: 76.3, rx: 6.7, ry: 9.4 },
    { cx: 125.1, cy: 76.3, rx: 6.7, ry: 9.4 }
  ],
  catchlight: { dx: 2, dy: -3.8, r: 2.4 },
  beak: "M100 75.6 C 97.1 75.6, 90.9 81.2, 90.4 83.1 C 90.2 84.2, 98 88.5, 100 88.5 C 102 88.5, 109.8 84.2, 109.6 83.1 C 109.1 81.2, 102.9 75.6, 100 75.6 Z",
  sweat: "M56 52 q 7 10 0 15 q -7 -5 0 -15 Z"
} as const

export const thinkingShapes = {
  chinWing:
    "M90.4 98.5 C 90.8 102.2, 89 107.1, 87.6 111.2 C 86.2 115.3, 84.3 119.3, 81.9 122.9 C 79.5 126.5, 76.6 130, 73.3 132.8 C 70.1 135.6, 66.3 138, 62.3 139.7 C 58.4 141.3, 53.9 142.5, 49.7 142.7 C 45.4 142.8, 40.7 142.3, 36.9 140.7 C 33 139.1, 29 136.2, 26.5 132.9 C 24.1 129.6, 22.8 124.9, 22.2 120.8 C 21.6 116.6, 22.1 112, 23.1 107.8 C 24.1 103.7, 25.6 98.3, 28.4 96 C 31.2 93.7, 36.3 93, 39.9 93.9 C 43.6 94.9, 46.4 100.3, 50.3 101.7 C 54.1 103.1, 58.9 103, 63 102.1 C 67 101.3, 70.9 98.6, 74.6 96.4 C 78.3 94.1, 82.6 88.5, 85.2 88.8 C 87.8 89.2, 90 94.8, 90.4 98.5 Z",
  trail: [
    { cx: 119, cy: 15, r: 3.4 },
    { cx: 127, cy: 2, r: 5 }
  ],
  bubble:
    "M114 -14 A 11 11 0 0 1 103 -32 A 11.5 11.5 0 0 1 118 -48 A 12.5 12.5 0 0 1 140 -54 A 12.5 12.5 0 0 1 162 -48 A 11.5 11.5 0 0 1 177 -32 A 11 11 0 0 1 166 -14 A 14 14 0 0 1 140 -10 A 14 14 0 0 1 114 -14 Z",
  dots: [
    { cx: 126, cy: -33, r: 4 },
    { cx: 140, cy: -33, r: 4 },
    { cx: 154, cy: -33, r: 4 }
  ],
  headroom: 62
} as const

export const readingShapes = {
  eyes: frontShapes.eyes,
  catchlight: { ...frontShapes.catchlight, dy: -frontShapes.catchlight.dy, inward: true },
  cheeks: [
    { cx: 64.1, cy: 88.8, rx: 8.8, ry: 5.9 },
    { cx: 135.9, cy: 88.8, rx: 8.8, ry: 5.9 }
  ],
  glasses: {
    lenses: [
      { cx: 72.8, cy: 74.5, r: 17 },
      { cx: 127.2, cy: 74.5, r: 17 }
    ],
    stroke: 2.4,
    bridge: "M89.8 74 Q 100 68 110.2 74"
  },
  wings: [
    "M37.4 82.7 C 46.3 82.7, 66.3 124.7, 66.3 131.9 C 66.3 137.9, 61 140.6, 55.7 140.6 C 40.2 140.6, 23.3 128.8, 23.3 114.7 C 23.3 104.6, 31 82.7, 37.4 82.7 Z",
    "M162.6 82.7 C 153.7 82.7, 133.7 124.7, 133.7 131.9 C 133.7 137.9, 139 140.6, 144.3 140.6 C 159.8 140.6, 176.7 128.8, 176.7 114.7 C 176.7 104.6, 169 82.7, 162.6 82.7 Z"
  ],
  book: {
    coverTop: "M21 179 L 179 179 L 185.5 189 L 14.5 189 Z",
    coverEdge:
      "M13.2 188.6 C 40 187.6, 70 186.2, 100 185.6 C 130 186.2, 160 187.6, 186.8 188.6 C 188.6 188.7, 189.2 191.6, 187.4 193.4 C 186.6 194.2, 185.6 194.6, 184.4 194.6 C 156 193.4, 128 192.2, 100 192 C 72 192.2, 44 193.4, 15.6 194.6 C 14.4 194.6, 13.4 194.2, 12.6 193.4 C 10.8 191.6, 11.4 188.7, 13.2 188.6 Z",
    stacks: [
      "M19.9 165.9 C 35 161.5, 52 160.5, 62 161.8 C 76 163.5, 89 170, 100 179 L 100 188 C 72 187.4, 44 188.4, 19.9 189.6 Z",
      "M180.1 165.9 C 165 161.5, 148 160.5, 138 161.8 C 124 163.5, 111 170, 100 179 L 100 188 C 128 187.4, 156 188.4, 180.1 189.6 Z"
    ],
    stackLines:
      "M19.9 171.6 C 38 167.2, 58 166.4, 70 168.2 C 82 170, 91 175, 97.5 180.6 M180.1 171.6 C 162 167.2, 142 166.4, 130 168.2 C 118 170, 109 175, 102.5 180.6 M19.9 177.4 C 38 173.4, 58 172.8, 70 174.4 C 82 176, 90 179.4, 96 182.8 M180.1 177.4 C 162 173.4, 142 172.8, 130 174.4 C 118 176, 110 179.4, 104 182.8 M19.9 183.2 C 38 179.8, 58 179.4, 70 180.6 C 82 181.8, 89 183.6, 93 185 M180.1 183.2 C 162 179.8, 142 179.4, 130 180.6 C 118 181.8, 111 183.6, 107 185",
    // Exact mirror images across x = 100 so flipping pages[0] to scaleX = -1 lands invisibly on pages[1].
    pages: [
      "M19.9 165.9 L 32 142.6 C 45 137, 60 132.5, 72 131.5 C 84 130.8, 94 134.5, 100 144 L 100 179 C 89 170, 76 163.5, 62 161.8 C 52 160.5, 35 161.5, 19.9 165.9 Z",
      "M180.1 165.9 L 168 142.6 C 155 137, 140 132.5, 128 131.5 C 116 130.8, 106 134.5, 100 144 L 100 179 C 111 170, 124 163.5, 138 161.8 C 148 160.5, 165 161.5, 180.1 165.9 Z"
    ],
    edges: [
      "M32 142.6 C 45 137, 60 132.5, 72 131.5 C 84 130.8, 94 134.5, 100 144",
      "M168 142.6 C 155 137, 140 132.5, 128 131.5 C 116 130.8, 106 134.5, 100 144"
    ],
    print: [
      "M73.9 137.6 C 80 138, 87 139.8, 92.8 144.6 M44 145.6 C 57 143, 76 142.2, 92.3 150.4 M38.8 152.2 C 53 149.3, 76 148.4, 92.3 156 M30.2 158 C 46 154.6, 74 153.6, 91.7 163",
      "M126.1 137.6 C 120 138, 113 139.8, 107.2 144.6 M156 145.6 C 143 143, 124 142.2, 107.7 150.4 M161.2 152.2 C 147 149.3, 124 148.4, 107.7 156 M169.8 158 C 154 154.6, 126 153.6, 108.3 163"
    ],
    gutter: "M100 144 V 179",
    spine:
      "M85.4 191.4 C 85.8 182.4, 92 177, 100 177 C 108 177, 114.2 182.4, 114.6 191.4 C 110 194.6, 105 195.6, 100 195.6 C 95 195.6, 90 194.6, 85.4 191.4 Z",
    spineHollow:
      "M89.6 189.4 C 90 183.2, 94.6 179.8, 100 179.8 C 105.4 179.8, 110 183.2, 110.4 189.4 C 107 191.4, 103.5 192, 100 192 C 96.5 192, 93 191.4, 89.6 189.4 Z"
  },
  landing
} as const

export const catchlightDx = (catchlight: { readonly dx: number; readonly inward?: boolean }, cx: number) =>
  catchlight.inward === true && cx > 100 ? -catchlight.dx : catchlight.dx

export type Mood = "neutral" | "happy" | "thinking" | "reading" | "sleepy" | "celebrate" | "oops"

export type Facing = "left" | "right" | "front"

export const frontMoods: ReadonlySet<Mood> = new Set(["thinking", "reading"])

export const headroom = (mood: Mood) => (mood === "thinking" ? thinkingShapes.headroom : 0)
