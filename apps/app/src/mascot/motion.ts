import { confetti, joints, type Mood, type palette, readingShapes, type Shape } from "./geometry.ts"

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
 * loop comes round.
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

export type ClipName = "celebrate" | "thinking" | "startReading" | "reading" | "sleepy" | "blink"

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

/**
 * Keys that keep a part at the page wing's tip as the wing turns and grows
 * by `wing`'s keys, sampled every 30 ms from `from` until `to`, where the
 * wing lets go of it in the place it's drawn.
 */
const carried = (wing: typeof liftGlasses, from: number, to: number) => {
  const joint = joints.pageWing
  const tip = (t: number) => {
    const a = (sample(wing.rotate, t, 0) * Math.PI) / 180
    const scale = sample(wing.scale, t, 1)
    const dx = (wingTip.x - joint.x) * scale
    const dy = (wingTip.y - joint.y) * scale
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
  }
  const end = tip(to)
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
 * A spark's flight and its trail's, sampled every 20 ms as it goes. It flies
 * as something thrown does: across, slowing a little as the air drags on it,
 * and up, slower and slower to the top of its arc, then down, faster and
 * faster, as gravity pulls it. The trail points back the way the spark came,
 * never reaching back past the foot of the spine, and shortens as the spark
 * burns out, to nothing as it winks out.
 */
const sparkFlight = (spark: SparkPart) => {
  const { at, rise, to, span, spin } = sparkFlights[spark]
  const { origin, trail, sparks } = readingShapes.landing
  // A smaller spark trails as much less.
  const scale = sparks[spark].r / biggestSpark
  const from = start.land + at
  const across = to[0] - origin.x
  // The arc is a parabola in time, `fall` from its top to its end: it reaches
  // the top at `peak` of the flight, and `pull` is how hard gravity pulls.
  const fall = to[1] - (origin.y - rise)
  const peak = Math.sqrt(rise) / (Math.sqrt(rise) + Math.sqrt(fall))
  const pull = rise / (peak * peak)
  // Where it is at `s` of its flight, from the foot of the spine, and which way it's going.
  const right = (s: number) => across * (0.6 * s + 0.4 * (1 - (1 - s) * (1 - s)))
  const down = (s: number) => pull * (s - peak) * (s - peak) - rise
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

const flights = Object.fromEntries(sparkParts.map((spark) => [spark, sparkFlight(spark)])) as Record<
  SparkPart,
  ReturnType<typeof sparkFlight>
>

/** Each spark's track and its trail's, for a clip's `tracks`. */
const sparkTracks = Object.fromEntries(
  sparkParts.flatMap((spark, i) => [
    [spark, flights[spark].spark],
    [trailParts[i], flights[spark].trail]
  ])
)

/**
 * One of the puffs of dust the book squeezes out from under it as it lands:
 * from behind the foot of its spine, it rolls `outward` box units along the
 * ground in front of the book and a little up, swelling quickly, then thins
 * and fades as it drifts.
 */
const puff = (outward: number) => {
  const swell = [
    [0, 0.4],
    [start.land, 0.4],
    [start.land + 160, 1, "out"],
    [start.done - 40, 1.25, "linear"]
  ] as const
  return {
    x: [
      [0, 0],
      [start.land, 0],
      [start.done - 40, outward, "out"]
    ] as const,
    y: [
      [0, 0],
      [start.land, 0],
      [start.done - 40, -3, "out"]
    ] as const,
    scaleX: swell,
    scaleY: swell,
    opacity: [
      [0, 0],
      [start.land, 1, "step"],
      [start.land + 240, 1],
      [start.done - 40, 0, "in"]
    ] as const
  }
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
  startReading: {
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
      book: {
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
      },
      // The page Kotori turns waits on the book, which shows the same page, until it's settled.
      page: {
        opacity: [
          [0, 0],
          [start.done, 1, "step"]
        ]
      },
      puff0: puff(-52),
      puff1: puff(52),
      ...sparkTracks,
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
      }
    }
  },
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
      // The page rises as it turns over the spine, and stands tallest upright.
      // Landed, it looks just like the right page, so it goes straight back
      // over the left one, which it looks just like too, to turn again.
      page: {
        scaleX: [
          [0, 1],
          [140, 1],
          [640, -1],
          [660, 1, "step"]
        ],
        scaleY: [
          [0, 1],
          [140, 1],
          [390, 1.3, "out"],
          [640, 1, "in"]
        ],
        y: [
          [0, 0],
          [140, 0],
          [390, -9, "out"],
          [640, 0, "in"]
        ]
      },
      pageWing: {
        rotate: [
          [0, 0],
          [60, 0],
          [240, -15, "out"],
          [320, -15],
          [620, 0]
        ]
      }
    }
  },
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

/** What Kotori plays on taking a mood. Its last frame is how Kotori stays in that mood. */
export const entrances: Partial<Record<Mood, ClipName>> = { celebrate: "celebrate", reading: "startReading" }

/** What Kotori plays over and over in a mood, once any entrance ends, over the entrance's last frame. */
export const loops: Partial<Record<Mood, ClipName>> = { thinking: "thinking", reading: "reading", sleepy: "sleepy" }

/**
 * What Kotori plays now and then in a mood once it's in it: it blinks while
 * its eyes are open, reading too. Thinking, it holds still and only the
 * thought bubble moves.
 */
export const idles: Partial<Record<Mood, ClipName>> = { neutral: "blink", reading: "blink", oops: "blink" }

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
