import { confetti, joints, type Mood, type palette, readingShapes, type Shape, writingShapes } from "./geometry.ts"

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
 * list it in `entrances` to play it when Kotori takes a mood, in `loops` to
 * play it over and over in a mood, or in `idles` to play it now and then in
 * one. An entrance starts from the drawing and a loop starts and ends on it
 * (the tests hold them to that), so nothing jumps as the mood changes or as a
 * loop comes round. To play a change of mood out rather than cut to the new
 * one, list it in `moves`: Kotori lets the old mood's loop come round to its
 * drawing first, and plays the move's clip, if it has one, from there. An
 * entrance that carries on from another mood's drawing rather than the plain
 * one, as writing's does from reading's, needs a move to wait for it.
 *
 * Functions marked "worklet" also run on the UI thread, so keep them to plain
 * loops and property access: Babel may turn destructuring or `for…of` into
 * helper calls that don't exist there.
 */

export type Part = keyof typeof joints

/** The glints that twinkle beside Kotori as it finishes celebrating, rather than moving with it, biggest first. */
export const sparkleParts = ["sparkle0", "sparkle1", "sparkle2"] as const satisfies readonly Part[]

export type SparklePart = (typeof sparkleParts)[number]

/** The Zs that waft from Kotori's brow while it sleeps, smallest first. */
export const zParts = ["z0", "z1", "z2"] as const satisfies readonly Part[]

export type ZPart = (typeof zParts)[number]

/** The dust the dictionary puffs out from under its spine as it lands in front of Kotori, left then right. */
export const puffParts = ["puff0", "puff1"] as const satisfies readonly Part[]

/** The sparks that fly out from the foot of the dictionary's spine as it lands, in the order they fly. */
export const sparkParts = ["spark0", "spark1", "spark2", "spark3", "spark4"] as const satisfies readonly Part[]

/** The sparks' trails, in the same order. */
export const trailParts = ["trail0", "trail1", "trail2", "trail3", "trail4"] as const satisfies readonly Part[]

export type SparkPart = (typeof sparkParts)[number]

/** What the dictionary throws up as it lands. It's beside the book, not on it, and gone once it has settled. */
export const landingParts = [...puffParts, ...trailParts, ...sparkParts] as const

export type LandingPart = (typeof landingParts)[number]

/** The words Kotori writes, in the order it writes them. */
export const inkParts = ["ink0", "ink1", "ink2", "ink3", "ink4", "ink5"] as const satisfies readonly Part[]

export type InkPart = (typeof inkParts)[number]

/** The slips that hide what Kotori has yet to write of each word, in the same order. */
export const unwrittenParts = [
  "unwritten0",
  "unwritten1",
  "unwritten2",
  "unwritten3",
  "unwritten4",
  "unwritten5"
] as const satisfies readonly Part[]

/** The slip over each word Kotori writes. */
export const unwrittenOf = (part: InkPart) => unwrittenParts[inkParts.indexOf(part)] ?? "unwritten0"

/** What Kotori has out only to write: its quill, and the fresh page and all it writes there. */
export const writingParts = [
  "quill",
  "freshPage",
  "leaf",
  ...inkParts,
  ...unwrittenParts
] as const satisfies readonly Part[]

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
}

export type ClipName =
  | "celebrate"
  | "thinking"
  | "startReading"
  | "reading"
  | "startWriting"
  | "writing"
  | "finishWriting"
  | "sleepy"
  | "blink"

type Tracks = Clip["tracks"]

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

/** Where `part` is `t` ms into `clip`, and where it stays once the clip ends. */
const poseIn = (clip: Clip, part: Part, t: number): Pose => {
  "worklet"
  const track = clip.tracks[part]
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

/** Tracks that hold every part where `clip` leaves it, for a clip that carries on from there. */
const holding = (clip: Clip): Tracks =>
  Object.fromEntries(
    (Object.keys(joints) as Part[]).flatMap((part) => {
      const pose = poseIn(clip, part, Infinity)
      const held = (Object.keys(rest) as (keyof Pose)[])
        .filter((property) => pose[property] !== rest[property])
        .map((property): [keyof Pose, readonly Key[]] => [property, [[0, pose[property]]]])
      return held.length === 0 ? [] : [[part, Object.fromEntries(held)]]
    })
  )

/** Tracks that keep `parts` out of sight. */
const outOfSight = (parts: readonly Part[]): Tracks =>
  Object.fromEntries(parts.map((part) => [part, { opacity: [[0, 0]] }]))

/** `tracks` laid over `under`: where both move a part the same way, the track in `tracks` wins. */
const over = (under: Tracks, tracks: Tracks): Tracks =>
  Object.fromEntries(
    [...new Set([...Object.keys(under), ...Object.keys(tracks)])].map((part) => [
      part,
      { ...under[part as Part], ...tracks[part as Part] }
    ])
  )

/** A dot of the bubble's ellipsis hopping from `ms`, for 400 ms. */
const hop = (ms: number) => ({
  y: [
    [0, 0],
    [ms, 0],
    [ms + 160, -4, "out"],
    [ms + 400, 0]
  ] as const
})

/**
 * A Z fading in near the brow at `ms`, floating upward and outward over
 * 1200 ms while growing and tilting, and fading out into the air.
 */
const waft = (ms: number) => ({
  x: [
    [0, 2],
    [ms, 2],
    [ms + 1200, -3, "linear"],
    [2200, 2, "step"]
  ] as const,
  y: [
    [0, 3],
    [ms, 3],
    [ms + 1200, -5, "linear"],
    [2200, 3, "step"]
  ] as const,
  rotate: [
    [0, 6],
    [ms, 6],
    [ms + 1200, -6],
    [2200, 6, "step"]
  ] as const,
  scaleX: [
    [0, 0.75],
    [ms, 0.75],
    [ms + 400, 1, "out"],
    [ms + 1200, 1.08, "linear"],
    [2200, 0.75, "step"]
  ] as const,
  scaleY: [
    [0, 0.75],
    [ms, 0.75],
    [ms + 400, 1, "out"],
    [ms + 1200, 1.08, "linear"],
    [2200, 0.75, "step"]
  ] as const,
  opacity: [
    [0, 0],
    [ms, 0],
    [ms + 300, 1, "out"],
    [ms + 750, 1],
    [ms + 1200, 0, "in"],
    [2200, 0, "step"]
  ] as const
})

/**
 * Where Kotori's eyes rest as it reads, from when to when: `x` and `y` box
 * units from where they're drawn, eased there from the stop before.
 */
type Stop = readonly [from: number, to: number, x: number, y: number, ease?: Ease]

/** The eyes' keys for moving from stop to stop and resting at each. */
const gaze = (stops: readonly Stop[]) => {
  const keys = (value: (stop: Stop) => number) =>
    stops.flatMap((stop): Key[] => {
      const [from, to, , , ease] = stop
      return [ease === undefined ? [from, value(stop)] : [from, value(stop), ease], [to, value(stop)]]
    })
  return { x: keys((stop) => stop[2]), y: keys((stop) => stop[3]) }
}

/**
 * Kotori taking up a book to read: when the page wing has the glasses on,
 * when the book starts to fall and when it lands, when the book has stopped
 * bouncing, and when the dust and sparkles it threw up are gone, which ends
 * the clip.
 */
const start = { lift: 80, on: 420, fall: 760, land: 1000, settled: 1220, done: 1660 } as const

/**
 * The page wing as Kotori brings it round from its side, where it's tucked
 * in, lifts the glasses to its face, pushes them on and lowers it again.
 */
const liftGlasses = {
  rotate: [
    [0, 25],
    [start.lift, 25],
    [330, -76],
    [start.on, -84, "out"],
    [470, -84],
    [700, 0]
  ],
  scale: [
    [0, 0.8],
    [start.lift, 0.8],
    [300, 1, "out"]
  ]
} as const satisfies Record<string, readonly Key[]>

/** Where the page wing's tip is in the drawing, resting on the book. */
const wingTip = { x: 61, y: 140.6 }

/** How the page wing turns and grows, to carry something in its tip. */
type Carrying = { readonly rotate: readonly Key[]; readonly scale: readonly Key[] }

/**
 * Keys that keep a part at the page wing's tip as the wing turns and grows
 * by `wing`'s keys, sampled every 30 ms from `from` until `to`, where it's
 * in the place it's drawn at `drawn`: as the wing lets go of it, `to`, or
 * as the wing takes hold of it, `from`.
 */
const carried = (wing: Carrying, from: number, to: number, drawn = to) => {
  const joint = joints.pageWing
  const tip = (t: number) => {
    const a = (sample(wing.rotate, t, 0) * Math.PI) / 180
    const scale = sample(wing.scale, t, 1)
    const dx = (wingTip.x - joint.x) * scale
    const dy = (wingTip.y - joint.y) * scale
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
  }
  const end = tip(drawn)
  const times = Array.from({ length: Math.ceil((to - from) / 30) }, (_, i) => from + i * 30).concat(to)
  const keys = (axis: "x" | "y") =>
    times.map((t, i): Key => {
      const value = Math.round((tip(t)[axis] - end[axis]) * 100) / 100
      return i === 0 ? [t, value] : [t, value, "linear"]
    })
  return { x: keys("x"), y: keys("y") }
}

/** How long a sparkle glints for, in ms. */
const glintSpan = 440

/**
 * A sparkle glinting once from `ms`: it flares from nothing to its full size
 * as it starts to turn, holds there a moment as it turns on, and winks out
 * as it finishes a quarter turn.
 */
const glint = (ms: number) => {
  const scale = [
    [0, 0],
    [ms, 0],
    [ms + 150, 1, "out"],
    [ms + glintSpan, 0, "in"]
  ] as const
  return {
    rotate: [
      [0, -45],
      [ms, -45],
      [ms + glintSpan, 45, "linear"]
    ] as const,
    scaleX: scale,
    scaleY: scale,
    opacity: [
      [0, 0],
      [ms, 1, "step"],
      [ms + glintSpan, 0, "step"]
    ] as const
  }
}

type Point = readonly [x: number, y: number]

/**
 * How each spark flies as the book lands: `at` ms after it lands, from the
 * foot of the spine, up `rise` box units at the top of its arc and down to
 * where it ends up, `to`, for `span` ms, turning `spin` degrees clockwise (or
 * anticlockwise below zero) as it goes. Gravity has them all: none rises far,
 * and each comes down on the pages or beside the book. No two are alike: big ones go higher
 * and hang longer, small ones skip out low and quick, to either side in no
 * set order.
 */
const sparkFlights: Readonly<Record<SparkPart, { at: number; rise: number; to: Point; span: number; spin: number }>> = {
  spark0: { at: 0, rise: 28, to: [208, 186], span: 460, spin: 120 },
  spark1: { at: 30, rise: 40, to: [-4, 172], span: 600, spin: -90 },
  spark2: { at: 90, rise: 12, to: [40, 194], span: 340, spin: 180 },
  spark3: { at: 150, rise: 20, to: [214, 196], span: 420, spin: -120 },
  spark4: { at: 180, rise: 12, to: [160, 194], span: 340, spin: 90 }
}

/** The biggest spark's size, which its trail is drawn for (see `readingShapes.landing`). */
const biggestSpark = Math.max(...Object.values(readingShapes.landing.sparks).map((spark) => spark.r))

/**
 * A spark's flight and its trail's, sampled every 20 ms as it goes, thrown
 * up at `land` from `above` box units over the foot of the spine. It flies
 * as something thrown does: across, slowing a little as the air drags on it,
 * and up, slower and slower to the top of its arc, then down, faster and
 * faster, as gravity pulls it. The trail points back the way the spark came,
 * never reaching back past where it was thrown from, and shortens as the
 * spark burns out, to nothing as it winks out.
 */
const sparkFlight = (spark: SparkPart, land: number, above: number) => {
  const { at, rise, to, span, spin } = sparkFlights[spark]
  const { origin, trail, sparks } = readingShapes.landing
  // A smaller spark trails as much less.
  const scale = sparks[spark].r / biggestSpark
  const from = land + at
  const across = to[0] - origin.x
  // The arc is a parabola in time, `fall` from its top to its end: it reaches
  // the top at `peak` of the flight, and `pull` is how hard gravity pulls.
  const fall = to[1] - (origin.y - above - rise)
  const peak = Math.sqrt(rise) / (Math.sqrt(rise) + Math.sqrt(fall))
  const pull = rise / (peak * peak)
  // Where it is at `s` of its flight, from the foot of the spine, and which way it's going.
  const right = (s: number) => across * (0.6 * s + 0.4 * (1 - (1 - s) * (1 - s)))
  const down = (s: number) => pull * (s - peak) * (s - peak) - rise - above
  const heading = (s: number) => Math.atan2(2 * pull * (s - peak), across * (0.6 + 0.8 * (1 - s)))
  // How far it has come by `s`, adding up short straight steps.
  const travelled = (s: number) => {
    let total = 0
    for (let i = 1; i <= 20; i++) {
      const [a, b] = [(s * (i - 1)) / 20, (s * i) / 20]
      total += Math.hypot(right(b) - right(a), down(b) - down(a))
    }
    return total
  }
  const times = Array.from({ length: Math.ceil(span / 20) }, (_, i) => from + i * 20).concat(from + span)
  const round = (n: number) => Math.round(n * 100) / 100
  let turned = 0
  const samples = times.map((t) => {
    const s = (t - from) / span
    let angle = (heading(s) * 180) / Math.PI
    // Keep turning the same way rather than jumping a whole turn where the angle wraps round.
    while (angle - turned > 180) angle -= 360
    while (angle - turned < -180) angle += 360
    turned = angle
    return {
      t,
      x: round(right(s)),
      y: round(down(s)),
      angle: round(angle),
      length: round(Math.min(Math.sqrt(1 - s) * scale, travelled(s) / trail.length))
    }
  })
  const keys = (value: (sample: (typeof samples)[number]) => number) =>
    samples.map((sample, i): Key => (i === 0 ? [sample.t, value(sample)] : [sample.t, value(sample), "linear"]))
  const end = from + span
  const before = (value: number): Key[] => [[0, value]]
  const on = [
    [0, 0],
    [from, 1, "step"],
    [end, 0, "step"]
  ] as const
  // It flares up as it's thrown, flies at its full size, and winks out as it stops.
  const size = (full: number) =>
    [
      [0, 0],
      [from, 0],
      [from + 70, full, "out"],
      [end - 150, full],
      [end, 0, "in"]
    ] as const
  const x = [...before(0), ...keys((sample) => sample.x)]
  const y = [...before(0), ...keys((sample) => sample.y)]
  return {
    spark: {
      x,
      y,
      rotate: [
        [0, -spin / 2],
        [from, -spin / 2],
        [end, spin / 2, "linear"]
      ] as const,
      scaleX: size(1),
      scaleY: size(1),
      opacity: on
    },
    trail: {
      x,
      y,
      rotate: [...before(samples[0]?.angle ?? 0), ...keys((sample) => sample.angle)],
      scaleX: [...before(1), ...keys((sample) => sample.length)],
      scaleY: size(scale),
      opacity: on
    }
  }
}

/** Each spark's track and its trail's, for a clip's `tracks`, as they're thrown up at `land` from `above` box units over the foot of the spine. */
const sparksFrom = (land: number, above = 0): Tracks =>
  Object.fromEntries(
    sparkParts.flatMap((spark, i) => {
      const flight = sparkFlight(spark, land, above)
      return [
        [spark, flight.spark],
        [trailParts[i], flight.trail]
      ]
    })
  )

/**
 * One of the puffs of dust the book squeezes out from under it as it lands
 * at `land`: from `from` box units along the ground from the foot of its
 * spine, behind it, it rolls `outward` further along the ground in front of
 * the book and a little up, swelling quickly, then thins and fades as it
 * drifts, gone by `gone`.
 */
const puff = ({
  outward,
  land = start.land,
  gone = start.done,
  from = 0
}: {
  readonly outward: number
  readonly land?: number
  readonly gone?: number
  readonly from?: number
}): NonNullable<Tracks[Part]> => {
  const swell = [
    [0, 0.4],
    [land, 0.4],
    [land + 160, 1, "out"],
    [gone - 40, 1.25, "linear"]
  ] as const
  return {
    x: [
      [0, from],
      [land, from],
      [gone - 40, from + outward, "out"]
    ],
    y: [
      [0, 0],
      [land, 0],
      [gone - 40, -3, "out"]
    ],
    scaleX: swell,
    scaleY: swell,
    opacity: [
      [0, 0],
      [land, 1, "step"],
      [land + 240, 1],
      [gone - 40, 0, "in"]
    ]
  }
}

/** The book falling into Kotori's view as it starts to read, landing open in front of it, squashing a little and bouncing back. */
const falling = {
  y: [
    [0, -180],
    [start.fall, -180],
    [start.land, 0, "in"]
  ],
  scaleX: [
    [0, 1],
    [start.land, 1],
    [start.land + 70, 1.05, "out"],
    [start.settled, 1, "overshoot"]
  ],
  scaleY: [
    [0, 1],
    [start.land, 1],
    [start.land + 70, 0.88, "out"],
    [start.settled, 1, "overshoot"]
  ],
  opacity: [
    [0, 0],
    [start.fall, 0],
    [start.fall + 80, 1, "out"]
  ]
} as const satisfies Tracks[Part]

/**
 * As Kotori starts to read, from how it stands facing the viewer: it brings
 * its wing round from its side with its glasses in its tip, lifts them to
 * its face and pushes them on, then lowers the wing in front of it. It
 * brings its other wing round as a thick dictionary falls from above, which
 * it watches come down, and the book lands open in front of it, squashing
 * a little and bouncing back. As it lands, dust puffs out to each side
 * from under the foot of its spine and sparks fly out from there in arcs,
 * trailing behind them, and Kotori blinks, and opens its eyes looking down
 * at the page. The dust and the sparks are gone just after the book stops
 * bouncing.
 */
const startReading: Clip = {
  duration: start.done,
  tracks: {
    foldedWing0: {
      opacity: [
        [0, 1],
        [start.lift, 0, "step"]
      ]
    },
    pageWing: {
      rotate: [...liftGlasses.rotate, [start.land, 0], [start.land + 60, -6, "out"], [start.land + 200, 0]],
      scaleX: liftGlasses.scale,
      scaleY: liftGlasses.scale,
      opacity: [
        [0, 0],
        [start.lift, 1, "step"]
      ]
    },
    glasses: {
      ...carried(liftGlasses, start.lift, start.on),
      rotate: [
        [0, -20],
        [start.lift, -20],
        [330, 0]
      ],
      opacity: [
        [0, 0],
        [100, 0],
        [200, 1, "out"]
      ]
    },
    // Under the rims once the glasses are on, a little further in and slimmer than without them.
    cheeks: {
      y: [
        [0, -0.5],
        [330, -0.5],
        [start.on, 0, "out"]
      ],
      scaleX: [
        [0, 1.06],
        [330, 1.06],
        [start.on, 1, "out"]
      ],
      scaleY: [
        [0, 1.15],
        [330, 1.15],
        [start.on, 1, "out"]
      ]
    },
    foldedWing1: {
      opacity: [
        [0, 1],
        [600, 0, "step"]
      ]
    },
    bookWing: {
      rotate: [
        [0, -25],
        [600, -25],
        [820, 0],
        [start.land, 0],
        [start.land + 60, 6, "out"],
        [start.land + 200, 0]
      ],
      scaleX: [
        [0, 0.8],
        [600, 0.8],
        [800, 1, "out"]
      ],
      scaleY: [
        [0, 0.8],
        [600, 0.8],
        [800, 1, "out"]
      ],
      opacity: [
        [0, 0],
        [600, 1, "step"]
      ]
    },
    book: falling,
    spine: falling,
    bookLeft: falling,
    // The page Kotori turns waits on the book, which shows the same page, until it's settled.
    page: {
      opacity: [
        [0, 0],
        [start.done, 1, "step"]
      ]
    },
    puff0: puff({ outward: -52 }),
    puff1: puff({ outward: 52 }),
    ...sparksFrom(start.land),
    // Kotori looks up at the book as it appears and follows it down, then
    // blinks, and the eyes it reads with open in place of the ones it looked with.
    lookingEyes: {
      y: [
        [0, 0],
        [start.fall - 100, 0],
        [start.fall, -2.5, "out"],
        [start.land, 2, "in"],
        [start.land + 20, 0, "step"]
      ],
      opacity: [
        [0, 1],
        [start.land + 20, 0, "step"]
      ]
    },
    eyes: {
      y: [
        [0, 0],
        [start.fall - 100, 0],
        [start.fall, -2.5, "out"],
        [start.land, 2, "in"],
        [start.land + 140, 0, "step"]
      ],
      opacity: [
        [0, 1],
        [start.land + 20, 0, "step"],
        [start.land + 140, 1, "step"]
      ]
    },
    // It has no quill out, and nothing written, and the book is open.
    ...outOfSight([...writingParts, "bookBack"])
  }
}

/**
 * When the page Kotori turns, from when its wing starts to lift it: rises off
 * the left page, stands upright over the spine, lands on the right and,
 * looking just like the right page, goes straight back over the left one.
 */
const turn = { lift: 140, upright: 390, landed: 640, back: 660 } as const

/**
 * Kotori's wing lifting the corner of the left page from `at` and turning the
 * page over the spine onto the right. The page rises as it turns, and stands
 * tallest upright.
 */
const turnPage = (at: number) =>
  ({
    page: {
      scaleX: [
        [0, 1],
        [at + turn.lift, 1],
        [at + turn.landed, -1],
        [at + turn.back, 1, "step"]
      ],
      scaleY: [
        [0, 1],
        [at + turn.lift, 1],
        [at + turn.upright, 1.3, "out"],
        [at + turn.landed, 1, "in"]
      ],
      y: [
        [0, 0],
        [at + turn.lift, 0],
        [at + turn.upright, -9, "out"],
        [at + turn.landed, 0, "in"]
      ]
    },
    pageWing: {
      rotate: [
        [0, 0],
        [at + 60, 0],
        [at + 240, -15, "out"],
        [at + 320, -15],
        [at + 620, 0]
      ]
    }
  }) as const satisfies Tracks

/**
 * Kotori turning the page over to a fresh one from `at`, as it turns pages
 * reading, but past upright the page shows its back, which is blank: the
 * `leaf`, turning with it underneath, lands on the right in its place, and
 * goes back over the left one under it.
 */
const turnOver = (at: number) => {
  const { page, pageWing } = turnPage(at)
  return {
    page: {
      ...page,
      opacity: [
        [0, 1],
        [at + turn.upright, 0, "step"],
        [at + turn.back, 1, "step"]
      ]
    },
    leaf: { scaleX: page.scaleX, scaleY: page.scaleY, y: page.y },
    pageWing
  } as const satisfies Tracks
}

/** A number to a hundredth, for keys. */
const hundredths = (n: number) => Math.round(n * 100) / 100

/**
 * How Kotori writes: how fast its nib runs along a word, in box units a ms;
 * how long it takes to come down onto the page, to hop over to the next word
 * and to go back to the start of the next line, in ms; how high it lifts to
 * hop over and to go back; and how far the quill sways about its nib, in
 * degrees, as the nib runs along a word.
 */
const pen = { speed: 0.075, down: 80, hop: 60, back: 180, hopLift: 1.5, lift: 3, sway: 3 } as const

/** Where the nib comes to rest once the entry is written: where its last word ends. */
const restingNib = { x: writingShapes.words.ink5.to, y: writingShapes.words.ink5.y }

/**
 * How the wing that rests on the book moves to put the nib of the quill it
 * holds at `x`, `y`: it raises its shoulder half as far as the nib is above
 * where it comes to rest, `y` box units, and turns about the shoulder,
 * `rotate` degrees, and stretches, `scale`, for the rest of the way.
 */
const reaching = (x: number, y: number) => {
  const shoulder = joints.bookWing
  const nib = joints.quill
  const raised = hundredths((y - restingNib.y) / 2)
  const [dx, dy] = [x - shoulder.x, y - raised - shoulder.y]
  const drawn = Math.atan2(nib.y - shoulder.y, nib.x - shoulder.x)
  return {
    y: raised,
    rotate: Math.round(((Math.atan2(dy, dx) - drawn) * 180 * 1000) / Math.PI) / 1000,
    scale: Math.round((Math.hypot(dx, dy) / Math.hypot(nib.x - shoulder.x, nib.y - shoulder.y)) * 1e4) / 1e4
  }
}

/**
 * Where Kotori looks as its nib is at `x`, `y`: right of the spine, at the
 * nib, further right the further out it is, and down a little for each line
 * below the headword.
 */
const gazeAt = (x: number, y: number) => ({
  x: hundredths(Math.min(3, Math.max(-3, (x - 100) / 15))),
  y: hundredths(Math.min(0, Math.max(-1, (y - restingNib.y) / 10)))
})

/** Where Kotori's nib is `t` ms in. From one to the next, it moves in a straight line at an even pace. */
type Waypoint = { readonly t: number; readonly x: number; readonly y: number }

const nibAt = (waypoints: readonly Waypoint[], t: number): Point => {
  const last = waypoints.findLast((point) => point.t <= t)
  const next = waypoints.find((point) => point.t > t)
  if (last === undefined) return next === undefined ? [0, 0] : [next.x, next.y]
  if (next === undefined) return [last.x, last.y]
  const u = (t - last.t) / (next.t - last.t)
  return [last.x + (next.x - last.x) * u, last.y + (next.y - last.y) * u]
}

/** When Kotori writes each word, from when its nib starts it to when it leaves it. */
type Written = Readonly<Record<InkPart, { readonly start: number; readonly end: number }>>

/**
 * Kotori writing the entry out from `at`, its nib `pen.lift` above the start
 * of the headword: it comes down onto the page and writes each word from its
 * right end leftward, hops over to the next word on a line and lifts to go
 * back to the start of the next line, and comes to rest where the last word
 * ends. The nib's waypoints, when it writes each word, and when it's done.
 */
const writeOut = (at: number) => {
  const { ink0 } = writingShapes.words
  const waypoints: Waypoint[] = [{ t: at, x: ink0.from, y: ink0.y - pen.lift }]
  const written: [InkPart, { start: number; end: number }][] = []
  let t = at + pen.down
  let last: { readonly to: number; readonly y: number } | undefined
  for (const part of inkParts) {
    const word = writingShapes.words[part]
    if (last !== undefined) {
      const newLine = word.y !== last.y
      const span = newLine ? pen.back : pen.hop
      const lift = newLine ? pen.lift : pen.hopLift
      waypoints.push({ t: t + span / 2, x: (last.to + word.from) / 2, y: Math.min(last.y, word.y) - lift })
      t += span
    }
    waypoints.push({ t, x: word.from, y: word.y })
    const begun = t
    t += Math.round((word.from - word.to) / pen.speed)
    waypoints.push({ t, x: word.to, y: word.y })
    written.push([part, { start: begun, end: t }])
    last = word
  }
  return { waypoints, written: Object.fromEntries(written) as Written, end: t }
}

/** Keys for a value at each of `times`, moving in a straight line from one to the next. */
const linear = (times: readonly number[], value: (t: number) => number) =>
  times.map((t, i): Key => (i === 0 ? [t, value(t)] : [t, value(t), "linear"]))

/** Times every 20 ms from the first waypoint to the last, and at each waypoint, in order. */
const timesAlong = (waypoints: readonly Waypoint[]) => {
  const first = waypoints[0]?.t ?? 0
  const last = waypoints.at(-1)?.t ?? first
  const grid = Array.from({ length: Math.floor((last - first) / 20) + 1 }, (_, i) => first + i * 20)
  return [...new Set([...grid, ...waypoints.map((point) => point.t), last])].toSorted((a, b) => a - b)
}

/** The pose a loop plays over (see `combine`): the wing's turn and stretch, and where the eyes are. */
type Base = {
  readonly y: number
  readonly rotate: number
  readonly scale: number
  readonly eyes: { readonly x: number; readonly y: number }
}

/** No pose under a clip: it places the parts as they are. */
const unmoved: Base = { y: 0, rotate: 0, scale: 1, eyes: { x: 0, y: 0 } }

/**
 * The wing that rests on the book turning and stretching so the quill it
 * holds has its nib along `waypoints`, sampled every 20 ms, as moves from
 * `base`.
 */
const reachAlong = (waypoints: readonly Waypoint[], base: Base) => {
  const times = timesAlong(waypoints)
  const reach = (t: number) => {
    const [x, y] = nibAt(waypoints, t)
    return reaching(x, y)
  }
  const scale = linear(times, (t) => Math.round((reach(t).scale / base.scale) * 1e4) / 1e4)
  return {
    y: linear(times, (t) => hundredths(reach(t).y - base.y)),
    rotate: linear(times, (t) => Math.round((reach(t).rotate - base.rotate) * 1000) / 1000),
    scaleX: scale,
    scaleY: scale
  }
}

/**
 * The quill swaying to and fro about its nib as the nib runs along each word
 * written over `written`, once for every two humps of the word, and still
 * between words, sampled at the same times as the wing.
 */
const swayAlong = (waypoints: readonly Waypoint[], written: Written) =>
  linear(timesAlong(waypoints), (t) => {
    for (const part of inkParts) {
      const { start, end } = written[part]
      const cycles = Math.ceil(writingShapes.words[part].humps.length / 2)
      if (t > start && t < end)
        return hundredths(pen.sway * Math.sin((2 * Math.PI * cycles * (t - start)) / (end - start)))
    }
    return 0
  })

/** Kotori's eyes following its nib from the start of each word written over `written` to its end, as moves from `base`. */
const eyesAlong = (written: Written, base: Base) => {
  const looks = inkParts.flatMap((part) => {
    const word = writingShapes.words[part]
    const { start, end } = written[part]
    return [
      { t: start, ...gazeAt(word.from, word.y) },
      { t: end, ...gazeAt(word.to, word.y) }
    ]
  })
  const keys = (axis: "x" | "y") =>
    looks.map((look): Key => [look.t, hundredths(look[axis] - base.eyes[axis]), "linear"])
  return { x: keys("x"), y: keys("y") }
}

/**
 * Kotori's eyes glancing at the corner of the left page as its wing lifts it
 * to turn it from `at`, and following it over onto the right, as moves from
 * `base`; as it does reading.
 */
const eyesOnTurn = (at: number, base: Base) => {
  const keys = (glance: number, over: number, axis: "x" | "y"): Key[] => [
    [at + 230, hundredths(glance - base.eyes[axis])],
    [at + 250, hundredths(glance - base.eyes[axis])],
    [at + 640, hundredths(over - base.eyes[axis])],
    [at + 760, hundredths(over - base.eyes[axis])]
  ]
  return { x: keys(-3, 3, "x"), y: keys(0, -1, "y") }
}

/** `keys` with the first eased in `ease`, for keys that carry on from others. */
const easedIn = (keys: readonly Key[], ease: Ease): Key[] =>
  keys.map((key, i): Key => (i === 0 ? [key[0], key[1], ease] : key))

/**
 * The words Kotori writes over `written`, each coming out of the nib as the
 * nib runs along it: unseen until the nib starts it, then whole, with its
 * slip over the rest of it, left of the nib, until the nib leaves it. In a
 * loop, the words already on the page go `gone`, as the page that turned
 * over them goes back.
 */
const inking = (written: Written, gone?: number): Tracks =>
  Object.fromEntries(
    inkParts.flatMap((part) => {
      const { start, end } = written[part]
      const word = writingShapes.words[part]
      const reach = writingShapes.reach[part]
      const { slip } = writingShapes
      // The slip's left edge and top over the word, and how wide it is with the nib at `x`.
      const left = word.to - reach.beyond
      const width = (x: number) => Math.round(((x - left) / slip.width) * 1e4) / 1e4
      const over = (value: number): Key[] => [
        [0, 0],
        [start, value, "step"],
        [end, value],
        [end, 0, "step"]
      ]
      return [
        [
          part,
          {
            opacity:
              gone === undefined
                ? [
                    [0, 0],
                    [start, 1, "step"]
                  ]
                : [
                    [0, 1],
                    [gone, 0, "step"],
                    [start, 1, "step"]
                  ]
          }
        ],
        [
          unwrittenOf(part),
          {
            x: over(hundredths(left - slip.x)),
            y: over(hundredths(word.y - reach.above - slip.y)),
            scaleY: [
              [0, 1],
              [start, Math.round(((reach.above + reach.below) / slip.height) * 1e4) / 1e4, "step"],
              [end, 1, "step"]
            ],
            scaleX: [
              [0, 1],
              [start, width(word.from), "step"],
              [end, width(word.to), "linear"],
              [end, 1, "step"]
            ]
          }
        ]
      ]
    })
  )

/**
 * Kotori taking up its quill: when the wing that rests on the book has
 * started round to its side, when it has reached behind Kotori, when it
 * comes back with the quill in its tip, and when the quill is over the start
 * of the headword, ready to write.
 */
const fetch = { side: 280, behind: 540, back: 700, ready: 980 } as const

const firstDraft = writeOut(fetch.ready)

/**
 * As Kotori starts to write, from how it reads: its wing turns the page over
 * to a fresh one, blank on the back, its eyes following, as its other wing
 * goes round to its side, reaches behind it and comes back with the quill in
 * its tip, fading into view as its glasses do. It brings the quill over the
 * fresh page and writes the entry out, the headword and then what it means,
 * its eyes on the nib, and ends with the page written and the nib at rest
 * where the entry ends.
 */
const startWriting: Clip = {
  duration: firstDraft.end,
  tracks: over(over(holding(startReading), inking(firstDraft.written)), {
    ...turnOver(0),
    leaf: {
      ...turnOver(0).leaf,
      opacity: [
        [0, 0],
        [60, 1, "step"]
      ]
    },
    // The fresh page, and the slips lying on it, ready to hide what Kotori writes until it has.
    ...Object.fromEntries(
      (["freshPage", ...unwrittenParts] as const).map((part) => [
        part,
        {
          opacity: [
            [0, 0],
            [turn.back, 1, "step"]
          ]
        }
      ])
    ),
    // The wing goes round behind Kotori, where its folded one shows, and comes back with the quill.
    foldedWing1: {
      opacity: [
        [0, 0],
        [fetch.behind, 1, "step"],
        [fetch.back, 0, "step"]
      ]
    },
    bookWing: (() => {
      const wing = reachAlong(firstDraft.waypoints, unmoved)
      // From where it rests on the book round to its side, tucked in as it is before Kotori reads, and back with the quill.
      const round = (resting: number, tucked: number, keys: readonly Key[]): Key[] => [
        [0, resting],
        [fetch.side, resting],
        [fetch.behind, tucked],
        [fetch.back, tucked],
        ...easedIn(keys, "out")
      ]
      return {
        y: round(0, 0, wing.y),
        rotate: round(0, -25, wing.rotate),
        scaleX: round(1, 0.8, wing.scaleX),
        scaleY: round(1, 0.8, wing.scaleY),
        opacity: [
          [0, 1],
          [fetch.behind, 0, "step"],
          [fetch.back, 1, "step"]
        ]
      }
    })(),
    quill: {
      rotate: swayAlong(firstDraft.waypoints, firstDraft.written),
      opacity: [
        [0, 0],
        [fetch.back, 0],
        [fetch.back + 80, 1, "out"]
      ]
    },
    eyes: (() => {
      const turning = eyesOnTurn(0, unmoved)
      const writing = eyesAlong(firstDraft.written, unmoved)
      return {
        x: [[0, 0], [70, 0], ...turning.x, ...easedIn(writing.x, "inOut")],
        y: [[0, 0], [70, 0], ...turning.y, ...easedIn(writing.y, "inOut")]
      }
    })()
  })
}

/** Where the nib comes to rest once the entry is written, and how the wing and the eyes are then: the writing drawing. */
const home: Base = { ...reaching(restingNib.x, restingNib.y), eyes: gazeAt(restingNib.x, restingNib.y) }

/**
 * Kotori writing the page out again, on a loop: when it has lifted its nib
 * from the end of the entry, when its wing starts to turn the page over to a
 * fresh one, and when its nib is back over the start of the headword.
 */
const again = { lifted: 160, turn: 120, ready: 120 + turn.back + 200 } as const

const redraft = writeOut(again.ready)

/** The nib's way round the loop: up off the page, waiting for the page to turn, then writing the entry out again. */
const rewriting: readonly Waypoint[] = [
  { t: 0, ...restingNib },
  { t: again.lifted, x: restingNib.x, y: restingNib.y - pen.lift },
  { t: again.turn + turn.back, x: restingNib.x, y: restingNib.y - pen.lift },
  ...redraft.waypoints
]

/**
 * While writing, on a loop: from the page written, its nib at rest where the
 * entry ends, Kotori lifts its quill as its other wing turns the page over to
 * a fresh one, its eyes following the page, and the words go under the
 * page's blank back as it lands. Then it brings the nib over the headword and
 * writes the entry out again, its eyes on the nib, coming to rest where it
 * started.
 */
const writing: Clip = {
  duration: redraft.end,
  tracks: {
    ...turnOver(again.turn),
    bookWing: reachAlong(rewriting, home),
    quill: { rotate: swayAlong(rewriting, redraft.written) },
    ...inking(redraft.written, again.turn + turn.back),
    eyes: (() => {
      const turning = eyesOnTurn(again.turn, home)
      const writing = eyesAlong(redraft.written, home)
      return {
        x: [[0, 0], [again.turn + 70, 0], ...turning.x, ...easedIn(writing.x, "inOut")],
        y: [[0, 0], [again.turn + 70, 0], ...turning.y, ...easedIn(writing.y, "inOut")]
      }
    })()
  }
}

/**
 * Kotori finishing the entry: when the wing that holds the quill has lifted
 * it off the page and come round to Kotori's side, and when it has reached
 * behind Kotori, putting the quill away; when its other wing starts to close
 * the book, and when, the book shut and the dust it puffs out settling, it
 * reaches for its glasses to take them off; and when, the glasses off and
 * its wing back at its side, it's done.
 */
const finish = { side: 200, behind: 420, close: 240, off: 1020, done: 1840 } as const

/**
 * The page wing taking Kotori's glasses off from `finish.off`, as it puts
 * them on but the other way round: up to its face, where it takes hold of
 * them; lifting them off and away; and round to its side, tucked in.
 */
const takeOffGlasses = (() => {
  const at = finish.off
  return {
    at: { hold: at + 230, held: at + 280, lifted: at + 370, tucked: at + 620 },
    rotate: [
      [at, 0],
      [at + 230, -84],
      [at + 280, -84],
      [at + 370, -76, "in"],
      [at + 620, 25]
    ],
    scale: [
      [0, 1],
      [at + 400, 1],
      [at + 620, 0.8, "in"]
    ]
  } as const
})()

/**
 * `tracks` for a clip that carries on from where `clip` leaves things, with
 * each part held there until `at`: anything they key before then, but where
 * they are from the start, is dropped, and from `at` on they move as keyed.
 */
const heldUntil = (clip: Clip, at: number, tracks: Tracks): Tracks =>
  Object.fromEntries(
    Object.entries(tracks).map(([part, track]) => {
      const held = poseIn(clip, part as Part, Infinity)
      return [
        part,
        Object.fromEntries(
          Object.entries(track ?? {}).map(([property, keys]) => {
            const [first, ...later] = keys.filter(([t]) => t >= at)
            const before: Key = [0, held[property as keyof Pose]]
            return [property, first === undefined ? [before] : [before, [first[0], first[1], "step"], ...later]]
          })
        )
      ]
    })
  )

/**
 * How far the book slides as it shuts, so that shut, it lies in the middle,
 * in front of Kotori, as it did open: from the end of its spine to the far
 * corner of its back cover, where it lies over the right half.
 */
const toMiddle = -40

/**
 * Where the end of the book's spine goes as the book shuts: turned on its
 * side, its round back to the left, standing up against the pages' edges.
 */
const spineShut = { x: 10, y: -15, rotate: -90 } as const

/**
 * The book's left half closing over the right from `at`, as Kotori's wing
 * turns a page: rising off the left, upright over the spine, and landing on
 * the right, shut. As it turns, the book slides over to the middle, in front
 * of Kotori, and the end of its spine turns over on its side. The book
 * squashes a little as it lands and bounces back, and the air it shuts out
 * puffs dust out to each side from under it and throws up sparks from
 * where the covers meet.
 */
const closing = (at: number) => {
  const { lift, upright, landed } = { lift: at + turn.lift, upright: at + turn.upright, landed: at + turn.landed }
  const thud: Key[] = [
    [landed + 60, 0.92, "out"],
    [landed + 240, 1, "overshoot"]
  ]
  const sliding: Key[] = [
    [0, 0],
    [lift, 0],
    [landed, toMiddle, "inOut"]
  ]
  // Shutting, the cover presses the open right half flat, with what Kotori wrote on it, and hides it.
  const shut: Key[] = [
    [0, 1],
    [landed - 120, 1],
    [landed, 0, "in"]
  ]
  const turning = {
    x: sliding,
    scaleX: [
      [0, 1],
      [lift, 1],
      [landed, -1]
    ],
    scaleY: [[0, 1], [lift, 1], [upright, 1.3, "out"], [landed, 1, "in"], ...thud],
    y: [
      [0, 0],
      [lift, 0],
      [upright, -9, "out"],
      [landed, 0, "in"]
    ]
  } as const satisfies Tracks[Part]
  const onTheRight = Object.fromEntries(
    (["book", "freshPage", ...inkParts, ...unwrittenParts] as const).map((part) => [
      part,
      { x: sliding, opacity: poseIn(startWriting, part, Infinity).opacity === 0 ? [[0, 0]] : shut }
    ])
  ) as Tracks
  // The air pushed out from between the covers, gone as the book settles. Until
  // then, the dust and sparks stay out of sight where Kotori's writing left them.
  const gone = landed + 620
  const thrown = heldUntil(startWriting, landed, {
    puff0: puff({ outward: -26, land: landed, gone, from: -40 }),
    puff1: puff({ outward: 26, land: landed, gone, from: 40 }),
    ...sparksFrom(landed, 24)
  })
  return {
    upright,
    landed,
    tracks: {
      ...onTheRight,
      bookLeft: {
        ...turning,
        opacity: [
          [0, 1],
          [upright, 0, "step"]
        ]
      },
      bookBack: {
        ...turning,
        opacity: [
          [0, 0],
          [upright, 1, "step"]
        ]
      },
      spine: {
        x: [
          [0, 0],
          [lift, 0],
          [landed, toMiddle + spineShut.x, "inOut"]
        ],
        y: [
          [0, 0],
          [lift, 0],
          [upright, spineShut.y - 4, "out"],
          [landed, spineShut.y, "in"]
        ],
        rotate: [
          [0, 0],
          [lift, 0],
          [landed, spineShut.rotate, "inOut"]
        ]
      },
      ...thrown
    } as const satisfies Tracks
  }
}

/**
 * As Kotori finishes writing, from the page written: it lifts its quill off
 * the page and puts it away behind it, as its other wing closes the book over
 * what it has written, its eyes following the cover over. The book slides to
 * the middle as it shuts, its spine turning on its side, and lands with a
 * thud, puffing out dust and throwing up sparks. Then it takes its
 * glasses off, blinking, and opens the eyes it looks with, both wings back at
 * its sides. It's done there, ready to celebrate.
 */
const finishWriting: Clip = {
  duration: finish.done,
  tracks: over(holding(startWriting), {
    // The quill goes back the way it came: round to Kotori's side and behind it.
    bookWing: {
      y: [
        [0, home.y],
        [finish.side, 0]
      ],
      rotate: [
        [0, home.rotate],
        [finish.side, 0],
        [finish.behind, -25]
      ],
      scaleX: [
        [0, home.scale],
        [finish.side, 1],
        [finish.behind, 0.8]
      ],
      scaleY: [
        [0, home.scale],
        [finish.side, 1],
        [finish.behind, 0.8]
      ],
      opacity: [
        [0, 1],
        [finish.behind, 0, "step"]
      ]
    },
    foldedWing1: {
      opacity: [
        [0, 0],
        [finish.behind, 1, "step"]
      ]
    },
    quill: {
      opacity: [
        [0, 1],
        [finish.side, 1],
        [finish.behind - 40, 0]
      ]
    },
    // The left half of the book closes in place of the page Kotori turns.
    ...closing(finish.close).tracks,
    page: {
      opacity: [
        [0, 1],
        [finish.close, 0, "step"]
      ]
    },
    leaf: {
      opacity: [
        [0, 1],
        [finish.close, 0, "step"]
      ]
    },
    pageWing: {
      rotate: [...turnPage(finish.close).pageWing.rotate, ...takeOffGlasses.rotate],
      scaleX: takeOffGlasses.scale,
      scaleY: takeOffGlasses.scale,
      opacity: [
        [0, 1],
        [takeOffGlasses.at.tucked, 0, "step"]
      ]
    },
    foldedWing0: {
      opacity: [
        [0, 0],
        [takeOffGlasses.at.tucked, 1, "step"]
      ]
    },
    glasses: (() => {
      const { held, lifted, tucked } = takeOffGlasses.at
      const tip = carried(takeOffGlasses, held, tucked, held)
      return {
        x: [[0, 0], ...tip.x],
        y: [[0, 0], ...tip.y],
        rotate: [
          [0, 0],
          [lifted, 0],
          [tucked, -20]
        ],
        opacity: [
          [0, 1],
          [tucked - 140, 1],
          [tucked - 20, 0]
        ]
      }
    })(),
    // As the glasses come off the cheeks they sat on, a little further in and slimmer, settle back.
    cheeks: (() => {
      const { held, lifted } = takeOffGlasses.at
      const back = (from: number, to: number): Key[] => [
        [0, from],
        [held, from],
        [lifted, to, "out"]
      ]
      return { y: back(0, -0.5), scaleX: back(1, 1.06), scaleY: back(1, 1.15) }
    })(),
    // Its eyes leave the nib to follow the cover over, then blink as the
    // glasses come off, the eyes it looks with opening in place of the ones it read with.
    eyes: (() => {
      const turning = eyesOnTurn(finish.close, unmoved)
      const { held } = takeOffGlasses.at
      const gone: Key[] = [
        [0, 1],
        [held + 140, 0, "step"]
      ]
      return {
        x: [[0, home.eyes.x], [finish.close + 70, home.eyes.x], ...turning.x, [finish.off + 200, 0]],
        y: [[0, home.eyes.y], [finish.close + 70, home.eyes.y], ...turning.y, [finish.off + 200, 0]],
        opacity: [
          [0, 1],
          [held + 20, 0, "step"]
        ],
        scaleX: gone,
        scaleY: gone
      }
    })(),
    lookingEyes: {
      opacity: [
        [0, 0],
        [takeOffGlasses.at.held + 140, 1, "step"]
      ]
    }
  })
}

export const clips: Record<ClipName, Clip> = {
  /**
   * Crouch, hop up stretched and throw confetti from the top of the hop, land
   * squashed, and wave as it falls. As the confetti fades and the wing folds
   * back down, three sparkles glint in turn in front of Kotori's brow and are
   * gone, leaving it beaming.
   */
  celebrate: {
    duration: 1420 + glintSpan,
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
      },
      sparkle0: glint(1240),
      sparkle1: glint(1330),
      sparkle2: glint(1420)
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
  startReading,
  /**
   * While reading, on a loop: Kotori's wing lifts the corner of the left
   * page and turns it over onto the right as its eyes follow it; then it
   * reads on down the new page line by line, its eyes gliding calmly along a
   * line and pausing on the way, then sweeping back to the start of the next,
   * just below. Facing the viewer, it reads from its left to its right, so
   * its eyes move leftward on screen, and it turns pages from the viewer's
   * left to right. The loop starts and ends halfway along a line, where the
   * eyes are drawn.
   */
  reading: {
    duration: 2020,
    tracks: {
      eyes: gaze([
        [0, 70, 0, 0],
        // A glance at the corner of the page as the wing lifts it,
        [230, 250, -3, 0],
        // following it over onto the right, at the top of the next page,
        [640, 760, 3, -1],
        // along the top line,
        [960, 1120, 0, -1],
        [1320, 1460, -3, -1],
        // back to the start of the next,
        [1640, 1760, 3, 0],
        // and halfway along it.
        [1960, 2020, 0, 0]
      ]),
      // Landed, the page looks just like the right one, so it goes straight
      // back over the left one, which it looks just like too, to turn again.
      ...turnPage(0)
    }
  },
  startWriting,
  writing,
  finishWriting,
  /**
   * While sleeping, on a loop: Kotori breathes softly and nods as the three Zs
   * fade in one by one from its brow, float upward and outward, and fade away.
   */
  sleepy: {
    duration: 2200,
    tracks: {
      bird: {
        scaleX: [
          [0, 1],
          [950, 1.02],
          [2200, 1]
        ],
        scaleY: [
          [0, 1],
          [950, 0.98],
          [2200, 1]
        ]
      },
      face: {
        y: [
          [0, 0],
          [950, 1.5],
          [2200, 0]
        ]
      },
      z0: waft(0),
      z1: waft(350),
      z2: waft(700)
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

/**
 * What Kotori plays on taking a mood. Its last frame is how Kotori stays in
 * that mood. Writing's starts from the reading drawing (see `moves`).
 */
export const entrances: Partial<Record<Mood, ClipName>> = {
  celebrate: "celebrate",
  reading: "startReading",
  writing: "startWriting"
}

/** What Kotori plays over and over in a mood, once any entrance ends, over the entrance's last frame. */
export const loops: Partial<Record<Mood, ClipName>> = {
  thinking: "thinking",
  reading: "reading",
  writing: "writing",
  sleepy: "sleepy"
}

/**
 * What Kotori plays now and then in a mood once it's in it: it blinks while
 * its eyes are open, reading and writing too. Thinking, it holds still and
 * only the thought bubble moves.
 */
export const idles: Partial<Record<Mood, ClipName>> = {
  neutral: "blink",
  reading: "blink",
  writing: "blink",
  oops: "blink"
}

/**
 * A change of mood Kotori plays out rather than cutting straight to the new
 * one: it lets `from`'s loop come round to its drawing, plays `clip` from
 * there if there is one, and then takes `to` as it takes any mood, with its
 * entrance.
 */
export type Move = { readonly from: Mood; readonly to: Mood; readonly clip?: ClipName }

/**
 * Every change of mood Kotori plays out. Writing carries on from reading:
 * `startWriting` starts from the reading drawing, so Kotori finishes turning
 * the page it's on first. A fresh entry written, Kotori puts its quill away,
 * closes the book and takes its glasses off, then celebrates.
 */
export const moves: readonly Move[] = [
  { from: "reading", to: "writing" },
  { from: "writing", to: "celebrate", clip: "finishWriting" }
]

/** How Kotori goes from mood `from` to mood `to`, if it plays the change out. */
export const moveBetween = (from: Mood, to: Mood) => moves.find((move) => move.from === from && move.to === to)

/** Where `part` is `t` ms into a clip, and where it stays once the clip ends. */
export const poseAt = (name: ClipName | null, part: Part, t: number): Pose => {
  "worklet"
  return name === null ? rest : poseIn(clips[name], part, t)
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
 * How a Kotori `size` pixels square draws its sparkles: a pose to combine
 * with theirs, growing them about their middles. Below 100 px they grow,
 * though less than confetti does, so they don't shrink to specks and still
 * sit apart.
 */
export const sparklesFor = (size: number): Pose => {
  "worklet"
  const grow = Math.max(1, Math.sqrt(100 / size))
  return { x: 0, y: 0, rotate: 0, scaleX: grow, scaleY: grow, opacity: 1 }
}

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
