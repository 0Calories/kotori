import { joints, type Mood } from "./geometry.ts"

/**
 * Kotori's animations, kept as data. A clip moves the parts in `joints`
 * through keyframes, and `poseAt` says where a part is at any moment. The app
 * plays clips with Reanimated, which runs these same functions on the UI
 * thread on iOS and Android and in the page on the web, and `mascotSvg` draws
 * single frames from them, so an animation moves the same way everywhere and
 * can be checked as stills with `pnpm motion`.
 *
 * To add an animation, name it in `ClipName`, give it keys in `clips`, and
 * list it in `entrances` to play it when Kotori takes a mood, or in `loops` to
 * play it over and over in a mood. An entrance starts from the drawing and a
 * loop starts and ends on it (the tests hold them to that), so nothing jumps
 * as the mood changes or as a loop comes round.
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

export type Clip = {
  readonly duration: number
  readonly tracks: { readonly [P in Part]?: { readonly [K in keyof Pose]?: readonly Key[] } }
}

export type ClipName = "celebrate" | "thinking" | "blink"

/** A dot of the bubble's ellipsis hopping from `ms`, for 400 ms. */
const hop = (ms: number) => ({
  y: [
    [0, 0],
    [ms, 0],
    [ms + 160, -4, "out"],
    [ms + 400, 0]
  ] as const
})

export const clips: Record<ClipName, Clip> = {
  /** Crouch, hop up stretched, land squashed, wave, and fold the wing back down. */
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
    }
  },
  /**
   * While thinking, on a loop: the ellipsis hops dot by dot, and the bubble
   * bobs. Only the bubble moves; Kotori holds its pose.
   */
  thinking: {
    duration: 1400,
    tracks: {
      bubble: {
        y: [
          [0, 0],
          [700, -1.5],
          [1400, 0]
        ]
      },
      dot0: hop(100),
      dot1: hop(250),
      dot2: hop(400)
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
export const entrances: Partial<Record<Mood, ClipName>> = { celebrate: "celebrate" }

/** What Kotori plays over and over in a mood, once any entrance ends, over the entrance's last frame. */
export const loops: Partial<Record<Mood, ClipName>> = { thinking: "thinking" }

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

/** Where `part` stays in `mood`: the last frame of the mood's entrance. */
export const settled = (mood: Mood, part: Part) => poseAt(entrances[mood] ?? null, part, Infinity)

/**
 * A React Native transform placing `part` in a view `size` pixels wide that
 * shows the 200×200 box and `headroom` units above it. Views turn and scale
 * about their centre, so the joint is moved there first and back after.
 */
export const viewTransform = (pose: Pose, part: Part, size: number, headroom = 0) => {
  "worklet"
  const k = size / 200
  const joint = joints[part]
  const middle = (200 - headroom) / 2
  return [
    { translateX: (joint.x - 100 + pose.x) * k },
    { translateY: (joint.y - middle + pose.y) * k },
    { rotate: `${pose.rotate}deg` },
    { scaleX: pose.scaleX },
    { scaleY: pose.scaleY },
    { translateX: (100 - joint.x) * k },
    { translateY: (middle - joint.y) * k }
  ]
}

/** The same placement as an SVG transform, in the box's own units. */
export const svgTransform = (pose: Pose, part: Part) => {
  const joint = joints[part]
  return `translate(${joint.x + pose.x} ${joint.y + pose.y}) rotate(${pose.rotate}) scale(${pose.scaleX} ${pose.scaleY}) translate(${-joint.x} ${-joint.y})`
}
