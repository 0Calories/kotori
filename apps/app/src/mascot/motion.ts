import { confetti, joints, type Mood, type palette, type Shape } from "./geometry.ts"

/**
 * Kotori's animations, kept as data. A clip moves the parts in `joints`
 * through keyframes, and `poseAt` says where a part is at any moment; a clip
 * can also throw confetti, which `pieceAt` places the same way. The app
 * plays clips with Reanimated, which runs these same functions on the UI
 * thread on iOS and Android and in the page on the web, and `mascotSvg` draws
 * single frames from them, so an animation moves the same way everywhere and
 * can be checked as stills with `pnpm motion`.
 *
 * To add an animation, name it in `ClipName`, give it keys in `clips`, and
 * list it in `entrances` to play it when Kotori takes a mood. An entrance
 * starts from the drawing (the tests hold it to that), so nothing jumps as the
 * mood changes.
 *
 * Functions marked "worklet" also run on the UI thread, so keep them to plain
 * loops and property access: Babel may turn destructuring or `for…of` into
 * helper calls that don't exist there.
 */

export type Part = keyof typeof joints

/**
 * Where a part sits relative to the drawing: moved `x` and `y` box units,
 * turned `rotate` degrees clockwise and scaled about its joint, and faded.
 */
export type Pose = {
  readonly x: number
  readonly y: number
  readonly rotate: number
  readonly scaleX: number
  readonly scaleY: number
  readonly opacity: number
}

/** The drawing as it is. */
export const rest: Pose = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 }

/**
 * How a value moves into a keyframe: `overshoot` goes about a tenth past it
 * and settles back, and `step` holds still until the key and jumps to it.
 */
type Ease = "linear" | "in" | "out" | "inOut" | "overshoot" | "step"

/** A value at a time in ms, eased in from the key before (`inOut` unless given). */
type Key = readonly [ms: number, value: number, ease?: Ease]

/**
 * A piece of confetti. The burst throws it from behind Kotori towards `to`,
 * and the air slows it nearly to a stop there; then it falls, swinging from
 * side to side and tumbling, and fades away before it lands.
 */
export type Piece = {
  readonly shape: Shape
  readonly color: keyof typeof palette
  /** Where the burst throws it, in box units. */
  readonly to: readonly [x: number, y: number]
  /** How long after the burst it's thrown, in ms. */
  readonly delay: number
  /** Turns a second, clockwise, or anticlockwise below zero; it tumbles over as often. */
  readonly spin: number
}

/** Confetti thrown `at` ms into a clip, from a point hidden behind Kotori. */
type Burst = {
  readonly at: number
  readonly from: readonly [x: number, y: number]
  /** The first six are the ones a small Kotori throws (see `confettiFor`). */
  readonly pieces: readonly Piece[]
}

export type Clip = {
  readonly duration: number
  readonly tracks: { readonly [P in Part]?: { readonly [K in keyof Pose]?: readonly Key[] } }
  /** Confetti the clip throws, behind Kotori. It has all faded by the time the clip ends. */
  readonly confetti?: Burst
  /** How much of the mood's extras show as the clip plays, for a clip that fades them; they show throughout otherwise. */
  readonly extras?: readonly Key[]
}

export type ClipName = "celebrate" | "thinking" | "blink"

export const clips: Record<ClipName, Clip> = {
  /**
   * Crouch, hop up stretched and throw confetti from the top of the hop, land
   * squashed, wave as it falls, and fold the wing back down as the sparkles
   * come out.
   */
  celebrate: {
    duration: 1620,
    tracks: {
      bird: {
        y: [
          [0, 0],
          [130, 0],
          [370, -28, "out"],
          [600, 0, "in"]
        ],
        scaleX: [
          [0, 1],
          [130, 1.1, "out"],
          [250, 0.94, "out"],
          [400, 1],
          [600, 0.98, "in"],
          [660, 1.08, "out"],
          [820, 1, "overshoot"]
        ],
        scaleY: [
          [0, 1],
          [130, 0.86, "out"],
          [250, 1.1, "out"],
          [400, 1],
          [600, 1.04, "in"],
          [660, 0.88, "out"],
          [820, 1, "overshoot"]
        ]
      },
      wing: {
        rotate: [
          [0, 0],
          [130, 8, "out"],
          [420, -95, "overshoot"],
          [640, -72],
          [840, -95],
          [1040, -72],
          [1240, -95],
          [1500, 5],
          [1620, 0]
        ]
      },
      tail: {
        rotate: [
          [0, 0],
          [130, -6, "out"],
          [320, 14],
          [540, -10],
          [720, 6],
          [900, 0, "out"]
        ]
      }
    },
    confetti: {
      at: 200,
      from: [92, 56],
      pieces: [
        { shape: "square", color: "peach", to: [-10, 28], delay: 0, spin: 1.1 },
        { shape: "curl", color: "blush", to: [178, -12], delay: 20, spin: -0.9 },
        { shape: "dot", color: "yellow", to: [86, -26], delay: 40, spin: 1.2 },
        { shape: "strip", color: "mint", to: [212, 54], delay: 10, spin: 1.3 },
        { shape: "dot", color: "mint", to: [-6, 60], delay: 50, spin: 0.8 },
        { shape: "square", color: "blush", to: [132, -20], delay: 30, spin: -1.2 },
        { shape: "squiggle", color: "peach", to: [40, -18], delay: 70, spin: -0.7 },
        { shape: "square", color: "yellow", to: [200, 12], delay: 60, spin: -1.4 },
        { shape: "squiggle", color: "mint", to: [16, 2], delay: 30, spin: 1 },
        { shape: "strip", color: "yellow", to: [60, -30], delay: 80, spin: -1 },
        { shape: "dot", color: "peach", to: [216, 92], delay: 40, spin: 1.3 },
        { shape: "curl", color: "blush", to: [-12, 100], delay: 70, spin: 0.9 }
      ]
    },
    // The sparkles wait until the confetti has fallen, and twinkle in as the wing settles.
    extras: [
      [0, 0],
      [1380, 0],
      [1560, 1, "out"]
    ]
  },
  /** Eyes drift up and to the side. */
  thinking: {
    duration: 280,
    tracks: {
      eyes: {
        x: [
          [0, 0],
          [280, -2.5, "out"]
        ],
        y: [
          [0, 0],
          [280, -3, "out"]
        ]
      }
    }
  },
  /** Eyes shut for a moment: the open eyes vanish, and the shut ones show in their place. */
  blink: {
    duration: 140,
    tracks: {
      eyes: {
        opacity: [
          [0, 0],
          [140, 1, "step"]
        ]
      }
    }
  }
}

/** What Kotori plays on taking a mood. Its last frame is how Kotori stays in that mood. */
export const entrances: Partial<Record<Mood, ClipName>> = { celebrate: "celebrate", thinking: "thinking" }

const ease = (curve: Ease, u: number) => {
  "worklet"
  switch (curve) {
    case "linear":
      return u
    case "in":
      return u * u * u
    case "out":
      return 1 - (1 - u) * (1 - u) * (1 - u)
    case "inOut":
      return u < 0.5 ? 4 * u * u * u : 1 - (2 - 2 * u) * (2 - 2 * u) * (2 - 2 * u) * 0.5
    case "overshoot":
      return 1 + 2.70158 * (u - 1) * (u - 1) * (u - 1) + 1.70158 * (u - 1) * (u - 1)
    case "step":
      return 0
  }
}

/** A track's value `t` ms in, holding its first key before and its last after; `fallback` without a track. */
const sample = (keys: readonly Key[] | undefined, t: number, fallback: number) => {
  "worklet"
  if (keys === undefined) return fallback
  let from: Key | undefined
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key === undefined) break
    if (t < key[0]) {
      if (from === undefined) return key[1]
      return from[1] + (key[1] - from[1]) * ease(key[2] ?? "inOut", (t - from[0]) / (key[0] - from[0]))
    }
    from = key
  }
  return from === undefined ? fallback : from[1]
}

/** Where `part` is `t` ms into a clip, and where it stays once the clip ends. */
export const poseAt = (name: ClipName | null, part: Part, t: number): Pose => {
  "worklet"
  const track = name === null ? undefined : clips[name].tracks[part]
  if (track === undefined) return rest
  return {
    x: sample(track.x, t, rest.x),
    y: sample(track.y, t, rest.y),
    rotate: sample(track.rotate, t, rest.rotate),
    scaleX: sample(track.scaleX, t, rest.scaleX),
    scaleY: sample(track.scaleY, t, rest.scaleY),
    opacity: sample(track.opacity, t, rest.opacity)
  }
}

/** Two clips playing at once, such as a blink during another clip: moves and turns add, scales and fades multiply. */
export const combine = (a: Pose, b: Pose): Pose => {
  "worklet"
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    rotate: a.rotate + b.rotate,
    scaleX: a.scaleX * b.scaleX,
    scaleY: a.scaleY * b.scaleY,
    opacity: a.opacity * b.opacity
  }
}

/** How much of the mood's extras show `t` ms into a clip. */
export const extrasAt = (name: ClipName | null, t: number) => {
  "worklet"
  return sample(name === null ? undefined : clips[name].extras, t, 1)
}

/** Where `part` stays in `mood`: the last frame of the mood's entrance. */
export const settled = (mood: Mood, part: Part) => poseAt(entrances[mood] ?? null, part, Infinity)

/**
 * A React Native transform placing `part` in a view `size` pixels square that
 * shows the 200×200 box. Views turn and scale about their centre, so the
 * joint is moved there first and back after.
 */
export const viewTransform = (pose: Pose, part: Part, size: number) => {
  "worklet"
  const k = size / 200
  const joint = joints[part]
  return [
    { translateX: (joint.x - 100 + pose.x) * k },
    { translateY: (joint.y - 100 + pose.y) * k },
    { rotate: `${pose.rotate}deg` },
    { scaleX: pose.scaleX },
    { scaleY: pose.scaleY },
    { translateX: (100 - joint.x) * k },
    { translateY: (100 - joint.y) * k }
  ]
}

/** The same placement as an SVG transform, in the box's own units. */
export const svgTransform = (pose: Pose, part: Part) => {
  const joint = joints[part]
  return `translate(${joint.x + pose.x} ${joint.y + pose.y}) rotate(${pose.rotate}) scale(${pose.scaleX} ${pose.scaleY}) translate(${-joint.x} ${-joint.y})`
}

/** After `drag` ms the air has slowed a thrown piece so much that it's gone about two thirds of the way. */
const drag = 120
/** How fast a piece falls once the air has slowed it, in box units a second. */
const fall = 85
/** How far a falling piece swings to each side, in box units, and how long it takes to swing there and back. */
const swing = { reach: 6, period: 800 }
/** How long a piece shows after it's thrown, in ms, fading over the last `fade`. */
const flight = { span: 1250, fade: 300 }

/** A piece that isn't showing. */
const hidden: Pose = { ...rest, opacity: 0 }

/**
 * Where piece `index` of the confetti `name` throws is `t` ms into the clip:
 * its centre in the box, how it's turned, flipped and faded. It's hidden
 * until it's thrown and once it has faded, and when the clip throws none.
 */
export const pieceAt = (name: ClipName | null, index: number, t: number): Pose => {
  "worklet"
  const burst = name === null ? undefined : clips[name].confetti
  const piece = burst === undefined ? undefined : burst.pieces[index]
  if (burst === undefined || piece === undefined) return hidden
  const s = t - burst.at - piece.delay
  if (!(s > 0 && s < flight.span)) return hidden
  // How far the throw has gone, and how many turns the piece has made.
  const thrown = 1 - Math.exp(-s / drag)
  const turns = (piece.spin * s) / 1000
  // Each piece starts its swing and its flip at its own point (the golden angle apart), so no two move together.
  const phase = index * 2.4
  const flip = Math.cos(Math.PI * turns + phase)
  return {
    x:
      burst.from[0] +
      (piece.to[0] - burst.from[0]) * thrown +
      swing.reach * thrown * Math.sin((2 * Math.PI * s) / swing.period + phase),
    y: burst.from[1] + (piece.to[1] - burst.from[1]) * thrown + (fall * (s - drag * thrown)) / 1000,
    rotate: 360 * turns + (phase * 180) / Math.PI,
    // Paper tumbles end over end and ribbon twists, so each flattens along its length and fills out again.
    scaleX: 1,
    scaleY: 0.5 + 0.5 * flip * flip,
    opacity: Math.min(1, (flight.span - s) / flight.fade)
  }
}

/**
 * How many of a clip's pieces a Kotori `size` pixels square throws, and how
 * much bigger it draws them. Below 100 px it throws only the first six, drawn
 * as big as at 100 px, so they don't shrink to specks.
 */
export const confettiFor = (size: number) => ({ count: size < 100 ? 6 : Infinity, grow: Math.max(1, 100 / size) })

/**
 * A React Native transform placing a piece in a view `size` pixels square that
 * shows the 200×200 box. The piece's own view is its canvas, grown by `grow`,
 * in the box's top left corner; views turn and scale about their centre, so
 * moving the canvas's centre to the piece's is all it takes.
 */
export const pieceTransform = (pose: Pose, size: number, grow: number) => {
  "worklet"
  const k = size / 200
  const half = (confetti.canvas * k * grow) / 2
  return [
    { translateX: pose.x * k - half },
    { translateY: pose.y * k - half },
    { rotate: `${pose.rotate}deg` },
    { scaleX: pose.scaleX },
    { scaleY: pose.scaleY }
  ]
}

/** The same placement as an SVG transform, in the box's own units, for a piece drawn about the origin. */
export const pieceSvgTransform = (pose: Pose, grow: number) =>
  `translate(${pose.x} ${pose.y}) rotate(${pose.rotate}) scale(${pose.scaleX * grow} ${pose.scaleY * grow})`
