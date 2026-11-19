import { confetti, joints, type Mood, type palette, readingShapes, type Shape } from "./geometry.ts"

export type Part = keyof typeof joints

export const sparkleParts = ["sparkle0", "sparkle1", "sparkle2"] as const satisfies readonly Part[]

export type SparklePart = (typeof sparkleParts)[number]

export const zParts = ["z0", "z1", "z2"] as const satisfies readonly Part[]

export type ZPart = (typeof zParts)[number]

export const puffParts = ["puff0", "puff1"] as const satisfies readonly Part[]

export const sparkParts = ["spark0", "spark1", "spark2", "spark3", "spark4"] as const satisfies readonly Part[]

export const trailParts = ["trail0", "trail1", "trail2", "trail3", "trail4"] as const satisfies readonly Part[]

export type SparkPart = (typeof sparkParts)[number]

export const landingParts = [...puffParts, ...trailParts, ...sparkParts] as const

export type LandingPart = (typeof landingParts)[number]

export type Pose = {
  readonly x: number
  readonly y: number
  readonly rotate: number
  readonly scaleX: number
  readonly scaleY: number
  readonly opacity: number
}

export const rest: Pose = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, opacity: 1 }

type Ease = "linear" | "in" | "out" | "inOut" | "overshoot" | "step"

type Key = readonly [ms: number, value: number, ease?: Ease]

export type Piece = {
  readonly shape: Shape
  readonly color: keyof typeof palette
  readonly to: readonly [x: number, y: number]
  readonly delay: number
  readonly spin: number
}

type Burst = {
  readonly at: number
  readonly from: readonly [x: number, y: number]
  readonly pieces: readonly Piece[]
}

export type Clip = {
  readonly duration: number
  readonly tracks: { readonly [P in Part]?: { readonly [K in keyof Pose]?: readonly Key[] } }
  readonly confetti?: Burst
}

export type ClipName = "celebrate" | "thinking" | "startReading" | "reading" | "sleepy" | "blink"

// Worklets avoid destructuring and for-of so Babel doesn't emit helper calls missing on the UI thread.
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

const hop = (ms: number) => ({
  y: [
    [0, 0],
    [ms, 0],
    [ms + 160, -4, "out"],
    [ms + 400, 0]
  ] as const
})

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

type Stop = readonly [from: number, to: number, x: number, y: number, ease?: Ease]

const gaze = (stops: readonly Stop[]) => {
  const keys = (value: (stop: Stop) => number) =>
    stops.flatMap((stop): Key[] => {
      const [from, to, , , ease] = stop
      return [ease === undefined ? [from, value(stop)] : [from, value(stop), ease], [to, value(stop)]]
    })
  return { x: keys((stop) => stop[2]), y: keys((stop) => stop[3]) }
}

const start = { lift: 80, on: 420, fall: 760, land: 1000, settled: 1220, done: 1660 } as const

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

const wingTip = { x: 61, y: 140.6 }

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

const glintSpan = 440

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

const sparkFlights: Readonly<Record<SparkPart, { at: number; rise: number; to: Point; span: number; spin: number }>> = {
  spark0: { at: 0, rise: 28, to: [208, 186], span: 460, spin: 120 },
  spark1: { at: 30, rise: 40, to: [-4, 172], span: 600, spin: -90 },
  spark2: { at: 90, rise: 12, to: [40, 194], span: 340, spin: 180 },
  spark3: { at: 150, rise: 20, to: [214, 196], span: 420, spin: -120 },
  spark4: { at: 180, rise: 12, to: [160, 194], span: 340, spin: 90 }
}

const biggestSpark = Math.max(...Object.values(readingShapes.landing.sparks).map((spark) => spark.r))

const sparkFlight = (spark: SparkPart) => {
  const { at, rise, to, span, spin } = sparkFlights[spark]
  const { origin, trail, sparks } = readingShapes.landing
  const scale = sparks[spark].r / biggestSpark
  const from = start.land + at
  const across = to[0] - origin.x
  // Parabolic arc peaking at `rise` above `origin.y` before falling to `to[1]`.
  const fall = to[1] - (origin.y - rise)
  const peak = Math.sqrt(rise) / (Math.sqrt(rise) + Math.sqrt(fall))
  const pull = rise / (peak * peak)
  const right = (s: number) => across * (0.6 * s + 0.4 * (1 - (1 - s) * (1 - s)))
  const down = (s: number) => pull * (s - peak) * (s - peak) - rise
  const heading = (s: number) => Math.atan2(2 * pull * (s - peak), across * (0.6 + 0.8 * (1 - s)))
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

const sparkTracks = Object.fromEntries(
  sparkParts.flatMap((spark, i) => [
    [spark, flights[spark].spark],
    [trailParts[i], flights[spark].trail]
  ])
)

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
      page: {
        opacity: [
          [0, 0],
          [start.done, 1, "step"]
        ]
      },
      puff0: puff(-52),
      puff1: puff(52),
      ...sparkTracks,
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
  reading: {
    duration: 2020,
    tracks: {
      eyes: gaze([
        [0, 70, 0, 0],
        [230, 250, -3, 0],
        [640, 760, 3, -1],
        [960, 1120, 0, -1],
        [1320, 1460, -3, -1],
        [1640, 1760, 3, 0],
        [1960, 2020, 0, 0]
      ]),
      page: {
        // Step back from -1 to 1 invisibly once flat on the mirrored right page.
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

export const entrances: Partial<Record<Mood, ClipName>> = { celebrate: "celebrate", reading: "startReading" }

export const loops: Partial<Record<Mood, ClipName>> = { thinking: "thinking", reading: "reading", sleepy: "sleepy" }

export const idles: Partial<Record<Mood, ClipName>> = { neutral: "blink", reading: "blink", oops: "blink" }

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

export const settled = (mood: Mood, part: Part) => poseAt(entrances[mood] ?? null, part, Infinity)

// React Native transforms rotate and scale around the view's center, so translate the joint to center and back.
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

export const svgTransform = (pose: Pose, part: Part) => {
  const joint = joints[part]
  return `translate(${joint.x + pose.x} ${joint.y + pose.y}) rotate(${pose.rotate}) scale(${pose.scaleX} ${pose.scaleY}) translate(${-joint.x} ${-joint.y})`
}

const drag = 120
const fall = 85
const swing = { reach: 6, period: 800 }
const flight = { span: 1250, fade: 300 }

const hidden: Pose = { ...rest, opacity: 0 }

export const pieceAt = (name: ClipName | null, index: number, t: number): Pose => {
  "worklet"
  const burst = name === null ? undefined : clips[name].confetti
  const piece = burst === undefined ? undefined : burst.pieces[index]
  if (burst === undefined || piece === undefined) return hidden
  const s = t - burst.at - piece.delay
  if (!(s > 0 && s < flight.span)) return hidden
  const thrown = 1 - Math.exp(-s / drag)
  const turns = (piece.spin * s) / 1000
  // Offset each piece by the golden angle (~2.4 rad) so pieces swing and tumble out of phase.
  const phase = index * 2.4
  const flip = Math.cos(Math.PI * turns + phase)
  return {
    x:
      burst.from[0] +
      (piece.to[0] - burst.from[0]) * thrown +
      swing.reach * thrown * Math.sin((2 * Math.PI * s) / swing.period + phase),
    y: burst.from[1] + (piece.to[1] - burst.from[1]) * thrown + (fall * (s - drag * thrown)) / 1000,
    rotate: 360 * turns + (phase * 180) / Math.PI,
    // Foreshorten scaleY with flip² so tumbling pieces flatten edge-on and fill out again.
    scaleX: 1,
    scaleY: 0.5 + 0.5 * flip * flip,
    opacity: Math.min(1, (flight.span - s) / flight.fade)
  }
}

export const confettiFor = (size: number) => ({ count: size < 100 ? 6 : Infinity, grow: Math.max(1, 100 / size) })

export const sparklesFor = (size: number): Pose => {
  "worklet"
  const grow = Math.max(1, Math.sqrt(100 / size))
  return { x: 0, y: 0, rotate: 0, scaleX: grow, scaleY: grow, opacity: 1 }
}

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

export const pieceSvgTransform = (pose: Pose, grow: number) =>
  `translate(${pose.x} ${pose.y}) rotate(${pose.rotate}) scale(${pose.scaleX * grow} ${pose.scaleY * grow})`
