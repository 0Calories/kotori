import { assert, describe, it } from "vitest"
import {
  catchlightDx,
  confetti,
  frontMoods,
  frontShapes,
  headroom,
  joints,
  type Mood,
  palette,
  readingShapes,
  shapes,
  puffPath,
  sparklePath,
  trailPath,
  thinkingShapes
} from "../src/mascot/geometry.ts"
import {
  type ClipName,
  clips,
  confettiFor,
  entrances,
  idles,
  loops,
  landingParts,
  type Part,
  pieceAt,
  pieceSvgTransform,
  pieceTransform,
  puffParts,
  sparkParts,
  type Pose,
  poseAt,
  rest,
  settled,
  type SparklePart,
  sparkleParts,
  sparklesFor,
  svgTransform,
  trailParts,
  viewTransform,
  type ZPart,
  zParts
} from "../src/mascot/motion.ts"
import { frameSvg, mascotSvg } from "../src/mascot/svg.ts"

const names = Object.keys(clips) as ClipName[]
const parts = Object.keys(joints) as Part[]
/** The parts of Kotori itself, not the sparkles, Zs or dust that float beside it. */
const kotori = parts.filter(
  (part) => !([...sparkleParts, ...zParts, ...landingParts] as readonly Part[]).includes(part)
)

type Point = readonly [number, number]

const near = (actual: Point, expected: Point) => {
  assert.closeTo(actual[0], expected[0], 1e-9)
  assert.closeTo(actual[1], expected[1], 1e-9)
}

const turn = ([x, y]: Point, degrees: number): Point => {
  const a = (degrees * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

/** A point through a React Native transform in a view `size` pixels wide and `height` high: about the view's centre, last step first. */
const throughView = (transform: ReturnType<typeof viewTransform>, size: number, point: Point, height = size): Point => {
  let p: Point = [point[0] - size / 2, point[1] - height / 2]
  for (const step of transform.toReversed()) {
    if (step.translateX !== undefined) p = [p[0] + step.translateX, p[1]]
    else if (step.translateY !== undefined) p = [p[0], p[1] + step.translateY]
    else if (step.scaleX !== undefined) p = [p[0] * step.scaleX, p[1]]
    else if (step.scaleY !== undefined) p = [p[0], p[1] * step.scaleY]
    else if (step.rotate !== undefined) p = turn(p, Number.parseFloat(step.rotate))
  }
  return [p[0] + size / 2, p[1] + height / 2]
}

type SvgStep = readonly [op: string, a: number, b: number]
const svgSteps = new Map<string, readonly SvgStep[]>()

/** A point through an SVG transform attribute, last function first. */
const throughSvg = (transform: string, point: Point): Point => {
  let steps = svgSteps.get(transform)
  if (steps === undefined) {
    steps = [...transform.matchAll(/(\w+)\(([^)]*)\)/g)].toReversed().map((match) => {
      const [a = 0, b = a] = (match[2] ?? "").split(" ").map(Number)
      return [match[1] ?? "", a, b] as const
    })
    svgSteps.set(transform, steps)
  }
  let p = point
  for (const [op, a, b] of steps) {
    if (op === "translate") p = [p[0] + a, p[1] + b]
    else if (op === "scale") p = [p[0] * a, p[1] * b]
    else if (op === "rotate") p = turn(p, a)
  }
  return p
}

describe("Kotori's clips", () => {
  it("start each mood's entrance from the drawing, so no part jumps as the mood changes, but reading's, which starts from the front view", () => {
    for (const name of Object.values(entrances).filter((name) => name !== "startReading")) {
      for (const part of kotori) assert.deepStrictEqual(poseAt(name, part, 0), rest, `${name}: ${part}`)
    }
    // The sparkles come with the mood, so they start out of sight.
    for (const part of sparkleParts) assert.strictEqual(poseAt("celebrate", part, 0).opacity, 0, part)
  })

  it("start and end each loop seamlessly, with Kotori on the drawing and sleepy's Zs fading in and out", () => {
    for (const name of Object.values(loops)) {
      for (const part of kotori) {
        assert.deepStrictEqual(poseAt(name, part, 0), rest, `${name}: ${part} at the start`)
        assert.deepStrictEqual(poseAt(name, part, clips[name].duration), rest, `${name}: ${part} at the end`)
      }
      for (const part of parts) {
        assert.deepStrictEqual(poseAt(name, part, clips[name].duration), poseAt(name, part, 0), `${name}: ${part}`)
      }
    }
    for (const part of zParts) assert.strictEqual(poseAt("sleepy", part, 0).opacity, 0, part)
  })

  it("keep their keys in order and within the clip", () => {
    for (const name of names) {
      const tracks = Object.values(clips[name].tracks).flatMap((track) => Object.values(track ?? {}))
      for (const keys of tracks) {
        const times = (keys ?? []).map(([ms]) => ms)
        assert.deepStrictEqual(
          times,
          [...times].sort((a, b) => a - b),
          name
        )
        assert.isAtMost(times.at(-1) ?? 0, clips[name].duration, name)
      }
    }
  })

  it("land Kotori back on its feet, so no mood's pose hangs mid-hop", () => {
    for (const name of Object.values(entrances)) assert.deepStrictEqual(poseAt(name, "bird", Infinity), rest, name)
  })

  it("fold the wing back down once Kotori has celebrated", () => {
    for (const part of kotori) assert.deepStrictEqual(poseAt("celebrate", part, Infinity), rest, part)
  })

  it("leave Kotori still while it thinks: no entrance or blink, and only the thought bubble and its dots move", () => {
    assert.isUndefined(entrances.thinking)
    assert.isUndefined(idles.thinking)
    for (const part of parts) assert.deepStrictEqual(settled("thinking", part), rest, part)
    assert.sameMembers(Object.keys(clips.thinking.tracks), ["bubble", "dot0", "dot1", "dot2"])
  })

  it("loop sleepy without an entrance or blink, floating and fading z0, z1 and z2 up in turn as Kotori breathes", () => {
    assert.isUndefined(entrances.sleepy)
    assert.isUndefined(idles.sleepy)
    assert.strictEqual(loops.sleepy, "sleepy")
    for (const part of parts) assert.deepStrictEqual(settled("sleepy", part), rest, part)
    assert.sameMembers(Object.keys(clips.sleepy.tracks), ["bird", "face", ...zParts])
    // Each Z fades in, floats upward and outward, and fades out after the one below it.
    const firstShow = (part: ZPart) => {
      for (let t = 0; t <= clips.sleepy.duration; t += 10) if (poseAt("sleepy", part, t).opacity > 0) return t
      return assert.fail(`${part} never shows`)
    }
    assert.isBelow(firstShow("z0"), firstShow("z1"))
    assert.isBelow(firstShow("z1"), firstShow("z2"))
    for (const part of zParts) {
      const start = firstShow(part)
      const peak = start + 400
      const end = start + 1190
      assert.strictEqual(poseAt("sleepy", part, peak).opacity, 1, `${part} reaches full opacity`)
      assert.isBelow(poseAt("sleepy", part, end).y, poseAt("sleepy", part, start).y - 7, `${part} floats up`)
      assert.isBelow(poseAt("sleepy", part, end).x, poseAt("sleepy", part, start).x - 4, `${part} drifts outward`)
      assert.strictEqual(poseAt("sleepy", part, clips.sleepy.duration).opacity, 0, `${part} fades out`)
    }
  })

  it("blink only in moods whose eyes are open", () => {
    const shut: Mood[] = ["happy", "celebrate", "sleepy"]
    for (const mood of Object.keys(idles) as Mood[])
      assert.strictEqual(idles[mood] === "blink", !shut.includes(mood), mood)
  })

  it("shut the eyes for the whole blink, then open them, since it plays over everything else", () => {
    assert.strictEqual(poseAt("blink", "eyes", 0).opacity, 0)
    assert.strictEqual(poseAt("blink", "eyes", clips.blink.duration - 1).opacity, 0)
    for (const part of parts) assert.deepStrictEqual(poseAt("blink", part, clips.blink.duration), rest, part)
  })

  it("ease between keys", () => {
    // Halfway to an `out` key, a value has gone seven eighths of the way.
    assert.closeTo(poseAt("celebrate", "bird", 250).y, -28 * 0.875, 1e-9)
  })
})

/**
 * How far a piece's outline reaches from its centre, at most: a curve stays
 * among its points and control points, and a circular arc no wider than a
 * semicircle stays within its radius of its chord's middle.
 */
const reach = (d: string) => {
  const tokens = d.match(/[A-Z]|-?[\d.]+/g) ?? []
  const counts: Partial<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, Z: 0 }
  let far = 0
  let at: Point = [0, 0]
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i] ?? ""
    const count = counts[command]
    if (count === undefined) assert.fail(`no bound for ${command} in ${d}`)
    const values = tokens.slice(i + 1, (i += 1 + count)).map(Number)
    if (command === "A") {
      const [r = 0, , , large, , x = 0, y = 0] = values
      assert.strictEqual(large, 0, d)
      far = Math.max(far, Math.hypot((at[0] + x) / 2, (at[1] + y) / 2) + r)
      at = [x, y]
      continue
    }
    if (command === "H") values.push(at[1])
    if (command === "V") values.unshift(at[0])
    for (let k = 0; k + 1 < values.length; k += 2) {
      at = [values[k] ?? 0, values[k + 1] ?? 0]
      far = Math.max(far, Math.hypot(...at))
    }
  }
  return far
}

/** Whether `point` is inside `polygon`: a ray from it to the right crosses the edges an odd number of times. */
const inside = (point: Point, polygon: readonly Point[]) => {
  let crossings = 0
  for (const [i, [x1, y1]] of polygon.entries()) {
    const [x2, y2] = polygon[(i + 1) % polygon.length] ?? [x1, y1]
    if (y1 > point[1] !== y2 > point[1] && point[0] < x1 + ((x2 - x1) * (point[1] - y1)) / (y2 - y1)) crossings++
  }
  return crossings % 2 === 1
}

/** Where the curves of Kotori's body meet. The body is convex, so it bulges past the shape these make. */
const bodyCorners = () => {
  const numbers = (shapes.body.match(/-?[\d.]+/g) ?? []).map(Number)
  const corners: Point[] = []
  // After the first point, each curve takes three: two control points, then where it ends.
  for (let i = 0; i < numbers.length; i += 6) corners.push([numbers[i] ?? 0, numbers[i + 1] ?? 0])
  return corners
}

describe("celebrate's confetti", () => {
  const { duration } = clips.celebrate
  const burst = clips.celebrate.confetti
  if (burst === undefined) throw new Error("celebrate throws no confetti")
  const indices = burst.pieces.map((_, i) => i)
  const every10ms = Array.from({ length: duration / 10 + 1 }, (_, i) => i * 10)
  const showing = (t: number) => indices.filter((i) => pieceAt("celebrate", i, t).opacity > 0)

  it("is thrown from behind Kotori, so no piece appears out of thin air", () => {
    for (const [i, piece] of burst.pieces.entries()) {
      const t = burst.at + piece.delay
      assert.strictEqual(pieceAt("celebrate", i, t).opacity, 0)
      const start = pieceAt("celebrate", i, t + 0.001)
      assert.closeTo(start.x, burst.from[0], 0.01)
      assert.closeTo(start.y, burst.from[1], 0.01)
      const body = bodyCorners().map((corner) =>
        throughSvg(svgTransform(poseAt("celebrate", "bird", t), "bird"), corner)
      )
      assert.isTrue(inside(burst.from, body), `piece ${i}`)
    }
  })

  it("sends each piece somewhere of its own, so none hides another", () => {
    const targets = burst.pieces.map((piece) => piece.to.join())
    assert.strictEqual(new Set(targets).size, targets.length)
  })

  it("has all fallen a few frames before the clip ends, when the app unmounts it", () => {
    for (let t = duration - 50; t <= duration; t += 10) assert.deepStrictEqual(showing(t), [], `${t} ms`)
    assert.deepStrictEqual(showing(Infinity), [])
  })

  it("is thrown as Kotori leaves the ground, so the burst and the hop are one jump", () => {
    const height = (t: number) => -poseAt("celebrate", "bird", t).y
    assert.isAbove(height(burst.at), 0)
    assert.isAbove(height(burst.at + 10), height(burst.at))
  })

  it("never falls below Kotori's box, onto what's under it, and stays near it at the sides and above", () => {
    for (const t of every10ms) {
      for (const i of showing(t)) {
        const { x, y } = pieceAt("celebrate", i, t)
        assert.isAtMost(y, 200, `piece ${i} at ${t} ms`)
        assert.isAtLeast(y, -40, `piece ${i} at ${t} ms`)
        assert.isAtLeast(x, -40, `piece ${i} at ${t} ms`)
        assert.isAtMost(x, 240, `piece ${i} at ${t} ms`)
      }
    }
  })

  it("is fewer, bigger pieces from a small Kotori, still in every colour and on both sides", () => {
    assert.deepStrictEqual(confettiFor(150), { count: Infinity, grow: 1 })
    const small = confettiFor(48)
    assert.strictEqual(small.count, 6)
    assert.closeTo(small.grow * 48, 100, 1e-9)
    const few = burst.pieces.slice(0, small.count)
    assert.sameMembers(
      [...new Set(few.map((piece) => piece.color))],
      [...new Set(burst.pieces.map((piece) => piece.color))]
    )
    assert.isTrue(few.some((piece) => piece.to[0] < joints.bird.x))
    assert.isTrue(few.some((piece) => piece.to[0] > joints.bird.x))
  })

  it("fits every piece on its canvas however it turns, so the app doesn't clip one the stills show whole", () => {
    for (const [shape, bit] of Object.entries(confetti.bits)) {
      assert.isAtMost(reach(bit.d) + (bit.stroke ?? 0) / 2, confetti.canvas / 2, shape)
    }
  })
})

/** Points along a path of cubic curves, close enough together to stand for its outline. */
const outline = (d: string) => {
  const numbers = (d.match(/-?[\d.]+/g) ?? []).map(Number)
  let from: Point = [numbers[0] ?? 0, numbers[1] ?? 0]
  const points: Point[] = []
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = numbers.slice(i, i + 6)
    for (let k = 0; k < 16; k++) {
      const u = k / 16
      const v = 1 - u
      points.push([
        v * v * v * from[0] + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x,
        v * v * v * from[1] + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y
      ])
    }
    from = [x, y]
  }
  return points
}

describe("celebrate's sparkles", () => {
  const { duration } = clips.celebrate
  const every10ms = Array.from({ length: duration / 10 + 1 }, (_, i) => i * 10)
  const pieces = clips.celebrate.confetti?.pieces ?? []
  const centre = (part: SparklePart, pose: Pose): Point => [joints[part].x + pose.x, joints[part].y + pose.y]
  /** The times `part` shows, to the ms. */
  const shown = (part: SparklePart) =>
    Array.from({ length: duration + 1 }, (_, t) => t).filter((t) => poseAt("celebrate", part, t).opacity > 0)

  it("glint once each, biggest first, growing from nothing where they're drawn and winking out there", () => {
    const radii = sparkleParts.map((part) => shapes.sparkles[part].r)
    assert.deepStrictEqual(
      radii,
      radii.toSorted((a, b) => b - a)
    )
    let previous = -Infinity
    for (const part of sparkleParts) {
      const times = shown(part)
      const first = times[0] ?? assert.fail(`${part} never shows`)
      const last = times.at(-1) ?? first
      assert.strictEqual(times.length, last - first + 1, `${part} shows once, without a break`)
      assert.isAbove(first, previous, `${part} comes after the one before`)
      previous = first
      const poses = times.map((t) => poseAt("celebrate", part, t))
      for (const pose of poses) assert.deepStrictEqual([pose.x, pose.y], [0, 0], part)
      assert.isBelow(poses[0]?.scaleX ?? 1, 0.05, `${part} starts from nothing`)
      assert.isBelow(poses.at(-1)?.scaleX ?? 1, 0.05, `${part} winks out`)
      assert.strictEqual(Math.max(...poses.map((pose) => pose.scaleX)), 1, `${part} reaches its drawn size`)
      assert.isAbove((poses.at(-1)?.rotate ?? 0) - (poses[0]?.rotate ?? 0), 80, `${part} turns as it glints`)
    }
  })

  it("come out only once the confetti is fading, so they take over from it", () => {
    for (const t of every10ms) {
      if (sparkleParts.some((part) => poseAt("celebrate", part, t).opacity > 0)) {
        for (const [i] of pieces.entries())
          assert.isBelow(pieceAt("celebrate", i, t).opacity, 1, `piece ${i} at ${t} ms`)
      }
    }
  })

  it("are all gone as the clip ends, so none is left behind in the mood", () => {
    for (const part of sparkleParts) assert.strictEqual(settled("celebrate", part).opacity, 0, part)
    // The last one winks out just as the clip ends, so it doesn't run on with nothing moving.
    assert.isAbove(poseAt("celebrate", "sparkle2", duration - 1).opacity, 0)
  })

  it("glint clear of Kotori and of each other, and within the tile around a small Kotori", () => {
    const grow = sparklesFor(48).scaleX
    const body = outline(shapes.body)
    for (const t of every10ms) {
      const bird = svgTransform(poseAt("celebrate", "bird", t), "bird")
      const placedBody = body.map((point) => throughSvg(bird, point))
      const tuft = shapes.tuft.map((c) => ({ at: throughSvg(bird, [c.cx, c.cy]), r: c.r }))
      const glinting = sparkleParts.flatMap((part) => {
        const pose = poseAt("celebrate", part, t)
        if (pose.opacity === 0) return []
        const at = centre(part, pose)
        const arm = shapes.sparkles[part].r * pose.scaleX * grow
        const label = `${part} at ${t} ms`
        assert.isFalse(inside(at, placedBody), label)
        assert.isAbove(Math.min(...placedBody.map(([x, y]) => Math.hypot(x - at[0], y - at[1]))), arm, label)
        for (const c of tuft) assert.isAbove(Math.hypot(c.at[0] - at[0], c.at[1] - at[1]) - c.r, arm, label)
        // The tile is 60 px around a 48 px Kotori, so it reaches 25 box units past the box.
        assert.isAtLeast(Math.min(...at) - arm, -25, label)
        assert.isAtMost(Math.max(...at) + arm, 225, label)
        return [{ at, arm }]
      })
      for (const [i, a] of glinting.entries()) {
        for (const b of glinting.slice(i + 1))
          assert.isAbove(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]), a.arm + b.arm, `apart at ${t} ms`)
      }
    }
  })

  it("are drawn inside Kotori's box, so the app's canvas, which turns and scales with them, doesn't clip them", () => {
    for (const part of sparkleParts) {
      const { cx, cy, r } = shapes.sparkles[part]
      assert.isAtLeast(Math.min(cx, cy) - r, 0, part)
      assert.isAtMost(Math.max(cx, cy) + r, 200, part)
    }
  })

  it("draw four tips `r` from their middles, so their size is what the tests above measure", () => {
    for (const part of sparkleParts) {
      const { cx, cy, r } = shapes.sparkles[part]
      const numbers = (sparklePath(shapes.sparkles[part]).match(/-?[\d.]+/g) ?? []).map(Number)
      const points: Point[] = []
      for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i] ?? 0, numbers[i + 1] ?? 0])
      const reaches = points.map(([x, y]) => Math.hypot(x - cx, y - cy))
      assert.closeTo(Math.max(...reaches), r, 1e-9, part)
      assert.strictEqual(
        reaches.filter((d) => Math.abs(d - r) < 1e-9).length,
        5,
        `${part}: four tips, back to the first`
      )
    }
  })

  it("grow beside a small Kotori, though less than its confetti does", () => {
    assert.deepStrictEqual(sparklesFor(150), rest)
    const small = sparklesFor(48)
    assert.isAbove(small.scaleX, 1.2)
    assert.isBelow(small.scaleX, confettiFor(48).grow)
    assert.deepStrictEqual({ ...small, scaleX: 1, scaleY: 1 }, rest)
  })
})

/** The numbers in a path, in order. */
const coordinates = (d: string) => (d.match(/-?[\d.]+/g) ?? []).map(Number)

/** The points and control points of a path whose commands all take pairs; a curve stays among them. */
const pointsOf = (d: string) => {
  const n = coordinates(d)
  return Array.from({ length: n.length / 2 }, (_, i): Point => [n[2 * i] ?? 0, n[2 * i + 1] ?? 0])
}

describe("reading", () => {
  const { duration } = clips.reading
  const every10ms = Array.from({ length: duration / 10 + 1 }, (_, i) => i * 10)
  const { glasses, book } = readingShapes
  const eyes = (t: number) => poseAt("reading", "eyes", t)
  const page = (t: number) => poseAt("reading", "page", t)
  const wing = (t: number) => poseAt("reading", "pageWing", t)

  /** How the eyes move between rests, in order: when each move starts and ends, and how far it goes. */
  const moves: { start: number; end: number; dx: number; dy: number }[] = []
  let start: number | null = null
  let from = eyes(0)
  for (const t of every10ms.slice(1)) {
    const before = eyes(t - 10)
    const moving = eyes(t).x !== before.x || eyes(t).y !== before.y
    if (moving && start === null) {
      start = t - 10
      from = before
    } else if (!moving && start !== null) {
      moves.push({ start, end: t - 10, dx: before.x - from.x, dy: before.y - from.y })
      start = null
    }
  }

  it("takes up the book, then loops, blinking now and then, and moves only its eyes, the page and the wing that turns it", () => {
    assert.strictEqual(entrances.reading, "startReading")
    assert.strictEqual(loops.reading, "reading")
    assert.strictEqual(idles.reading, "blink")
    assert.sameMembers(Object.keys(clips.reading.tracks), ["eyes", "page", "pageWing"])
    assert.isNull(start, "the eyes are resting as the loop comes round")
  })

  it("looks down through its glasses with the eyes it has facing the viewer: low in the lenses, catching the light below and towards the beak", () => {
    assert.deepStrictEqual(readingShapes.eyes, frontShapes.eyes)
    for (const [i, eye] of readingShapes.eyes.entries()) {
      const lens = glasses.lenses[i] ?? assert.fail(`no lens for eye ${i}`)
      assert.isAbove(eye.cy, lens.cy, `eye ${i}`)
    }
    const { catchlight } = readingShapes
    assert.deepStrictEqual(catchlight, { ...frontShapes.catchlight, dy: -frontShapes.catchlight.dy, inward: true })
    assert.isAbove(catchlight.dy, 0, "below the middle of the eye")
    const [left, right] = readingShapes.eyes
    assert.isAbove(catchlightDx(catchlight, left.cx), 0, "the left eye's, to its right")
    assert.strictEqual(
      catchlightDx(catchlight, right.cx),
      -catchlightDx(catchlight, left.cx),
      "the right eye's, mirrored"
    )
    const reading = mascotSvg({ mood: "reading" })
    for (const eye of readingShapes.eyes)
      assert.include(reading, `cx="${eye.cx + catchlightDx(catchlight, eye.cx)}" cy="${eye.cy + catchlight.dy}"`)
    // Kotori's other front-facing eyes catch the light to the right on both.
    assert.strictEqual(catchlightDx(frontShapes.catchlight, right.cx), frontShapes.catchlight.dx)
  })

  it("keeps its eyes inside its glasses wherever they look, clear of the rims", () => {
    for (const t of every10ms) {
      const { x, y } = eyes(t)
      for (const [i, eye] of readingShapes.eyes.entries()) {
        const lens = glasses.lenses[i] ?? assert.fail(`no lens for eye ${i}`)
        const far = Math.max(
          ...Array.from({ length: 72 }, (_, k) => {
            const a = (k * Math.PI) / 36
            return Math.hypot(eye.cx + x + eye.rx * Math.cos(a) - lens.cx, eye.cy + y + eye.ry * Math.sin(a) - lens.cy)
          })
        )
        assert.isBelow(far, lens.r - glasses.stroke / 2 - 0.5, `eye ${i} at ${t} ms`)
      }
    }
  })

  it("reads a line calmly, gliding leftward and pausing on the way, as Kotori reads from its left facing the viewer, then sweeps back to start the next line below", () => {
    // Reading, that is, not glancing at the page as it turns.
    const still = (t: number) => page(t).scaleX === 1 && page(t).y === 0 && wing(t).rotate === 0
    const reading = moves.filter((move) => still(move.start))
    const glides = reading.filter((move) => move.dx < 0 && move.dy === 0)
    const speed = (move: (typeof moves)[number]) => Math.abs(move.dx) / (move.end - move.start)
    for (const glide of glides) {
      assert.isAtLeast(glide.end - glide.start, 150, `the glide at ${glide.start} ms takes its time`)
      assert.isAtMost(-glide.dx, 3, `the glide at ${glide.start} ms goes a little way along`)
      // The eyes pause where they reach; after the last, until the first move as the loop comes round.
      const next = moves[moves.indexOf(glide) + 1]
      const pause = next === undefined ? duration - glide.end + (moves[0]?.start ?? 0) : next.start - glide.end
      assert.isAtLeast(pause, 100, `the glide at ${glide.start} ms pauses`)
    }
    const sweeps = reading.filter((move) => move.dx > 0 && move.dy > 0)
    assert.lengthOf(sweeps, 1)
    const sweep = sweeps[0] ?? assert.fail("the eyes never sweep back")
    // The glides leading up to the sweep: a whole line.
    const before = moves.slice(0, moves.indexOf(sweep)).toReversed()
    const end = before.findIndex((move) => !glides.includes(move))
    const line = (end === -1 ? before : before.slice(0, end)).toReversed()
    assert.isAtLeast(line.length, 2, "a line, a little at a time")
    assert.closeTo(sweep.dx, -line.reduce((sum, glide) => sum + glide.dx, 0), 1e-9, "back to the start of the line")
    const first = line[0] ?? assert.fail("no line")
    const last = line.at(-1) ?? first
    assert.isBelow(sweep.end - sweep.start, (last.end - first.start) / 2, "quicker than reading the line")
    for (const glide of line) assert.isAbove(speed(sweep), speed(glide), "faster than gliding along it")
  })

  it("barely moves its eyes up or down, only stepping down a line as it sweeps back, and never darts", () => {
    const ys = every10ms.map((t) => eyes(t).y)
    assert.isAtMost(Math.max(...ys) - Math.min(...ys), 1, "a line's height at most")
    for (const move of moves) {
      assert.isAtMost(Math.abs(move.dy), 1, `the move at ${move.start} ms`)
      assert.isAtLeast(move.end - move.start, 150, `the move at ${move.start} ms takes its time`)
    }
  })

  it("follows the page with its eyes as it turns, looking to whichever side it's on", () => {
    const turning = every10ms.filter((t) => Math.abs(page(t).scaleX) > 0.5 && Math.abs(page(t).scaleX) < 1)
    assert.isNotEmpty(turning)
    for (const t of turning) assert.strictEqual(Math.sign(eyes(t).x), -Math.sign(page(t).scaleX), `${t} ms`)
  })

  it("lifts the page with its wing and turns it from the left over the spine onto the right, as Kotori turns pages", () => {
    const lifting = every10ms.find((t) => wing(t).rotate !== 0) ?? assert.fail("the wing never moves")
    const turning = every10ms.find((t) => page(t).scaleX !== 1) ?? assert.fail("the page never turns")
    assert.isBelow(lifting, turning, "the wing moves first")
    // The wing reaches up and in, towards the spine, and is back on the book by the time the page lands.
    for (const t of every10ms) assert.isAtMost(wing(t).rotate, 0, `${t} ms`)
    const landed = every10ms.find((t) => page(t).scaleX === -1) ?? assert.fail("the page never lands")
    assert.strictEqual(wing(landed).rotate, 0)
    // The page rises off the book as it turns, and lies flat before and after.
    for (const t of every10ms) {
      const { scaleX, scaleY, y } = page(t)
      if (Math.abs(scaleX) === 1) assert.deepStrictEqual([y, scaleY], [0, 1], `${t} ms`)
      else assert.isBelow(y, 0, `${t} ms`)
    }
  })

  it("turns a page just like either page of the open book, so it can go back over the left between turns unseen", () => {
    for (const [left, right] of [book.pages, book.edges, book.print]) {
      const mirrored = coordinates(left).map((n, i) => (i % 2 === 0 ? 200 - n : n))
      const expected = coordinates(right)
      assert.lengthOf(mirrored, expected.length)
      for (const [i, n] of mirrored.entries()) assert.closeTo(n, expected[i] ?? Number.NaN, 1e-9)
    }
  })

  it("keeps the page it turns and the wing that turns it inside the box", () => {
    const moving = [
      ["page", pointsOf(book.pages[0])],
      ["pageWing", pointsOf(readingShapes.wings[0])]
    ] as const
    for (const t of every10ms) {
      for (const [part, points] of moving) {
        const transform = svgTransform(poseAt("reading", part, t), part)
        for (const point of points) {
          const [x, y] = throughSvg(transform, point)
          assert.isAtLeast(Math.min(x, y), 0, `${part} at ${t} ms`)
          assert.isAtMost(Math.max(x, y), 200, `${part} at ${t} ms`)
        }
      }
    }
    assert.strictEqual(headroom("reading"), 0)
  })
})

describe("taking up a book to read", () => {
  const { duration } = clips.startReading
  const every10ms = Array.from({ length: duration / 10 + 1 }, (_, i) => i * 10)
  const at = (part: Part, t: number) => poseAt("startReading", part, t)
  /** The parts Kotori has before it reads, which it reads without. */
  const before = ["foldedWing0", "foldedWing1", "lookingEyes"] as const satisfies readonly Part[]
  /** The parts it reads with, which come in as it takes up the book. */
  const after = ["glasses", "book", "page", "pageWing", "bookWing"] as const satisfies readonly Part[]
  /** When `part` first shows, or `null`. */
  const shown = (part: Part) => every10ms.find((t) => at(part, t).opacity > 0) ?? null
  /** When the glasses are on. */
  const on =
    every10ms.find(
      (t) =>
        t > (shown("glasses") ?? Infinity) &&
        Object.entries(rest).every(([k, v]) => at("glasses", t)[k as keyof Pose] === v)
    ) ?? assert.fail("the glasses never go on")
  /** When the book lands. */
  const landed = every10ms.find((t) => at("book", t).y === 0) ?? assert.fail("the book never lands")

  it("starts as Kotori stands facing the viewer: its wings at its sides, its eyes catching the light above, its feet showing, and no glasses or book", () => {
    for (const part of before) assert.deepStrictEqual(at(part, 0), rest, part)
    for (const part of after) assert.strictEqual(at(part, 0).opacity, 0, part)
    // The eyes it reads with are the same as the ones it looks with, which hide them.
    assert.deepStrictEqual(at("eyes", 0), at("lookingEyes", 0))
    assert.deepStrictEqual(readingShapes.eyes, frontShapes.eyes)
    // Its cheeks sit where they do facing the viewer.
    const transform = svgTransform(at("cheeks", 0), "cheeks")
    for (const [i, cheek] of readingShapes.cheeks.entries()) {
      const front = frontShapes.cheeks[i] ?? assert.fail(`no cheek ${i}`)
      const [cx, cy] = throughSvg(transform, [cheek.cx, cheek.cy])
      assert.closeTo(cx, front.cx, 0.1, `cheek ${i}`)
      assert.closeTo(cy, front.cy, 0.1, `cheek ${i}`)
      assert.closeTo(cheek.ry * at("cheeks", 0).scaleY, front.ry, 0.1, `cheek ${i}`)
    }
    const first = frameSvg("startReading", "reading", 0)
    for (const d of [...frontShapes.wings, frontShapes.feet.left, frontShapes.feet.right, frontShapes.body])
      assert.include(first, d)
    for (const d of [readingShapes.glasses.bridge, readingShapes.book.spine, ...readingShapes.wings])
      assert.notInclude(first, d)
    for (const eye of frontShapes.eyes)
      assert.include(first, `cx="${eye.cx + frontShapes.catchlight.dx}" cy="${eye.cy + frontShapes.catchlight.dy}"`)
  })

  it("ends on the drawing Kotori reads in, with the wings and eyes it had before gone, so the loop plays on from there", () => {
    for (const part of kotori) {
      const expected = (before as readonly Part[]).includes(part) ? { ...rest, opacity: 0 } : rest
      assert.deepStrictEqual(settled("reading", part), expected, part)
    }
    for (const part of landingParts) assert.strictEqual(settled("reading", part).opacity, 0, part)
    assert.strictEqual(
      frameSvg("startReading", "reading", duration),
      frameSvg("reading", "reading", 0),
      "the entrance's last frame is the loop's first"
    )
  })

  it("brings each wing round from its side, the one it reads with taking the place of the folded one as it starts to move", () => {
    for (const [folded, wing, outward] of [
      ["foldedWing0", "pageWing", 1],
      ["foldedWing1", "bookWing", -1]
    ] as const) {
      for (const t of every10ms)
        assert.strictEqual(at(folded, t).opacity + at(wing, t).opacity, 1, `${wing} at ${t} ms`)
      const swap = shown(wing) ?? assert.fail(`${wing} never shows`)
      assert.isAbove(at(wing, swap).rotate * outward, 15, `${wing} starts out at its side`)
      assert.isBelow(at(wing, swap).scaleX, 1, `${wing} starts tucked in`)
      assert.notDeepEqual(at(wing, swap + 30), at(wing, swap), `${wing} moves at once`)
    }
  })

  it("lifts the glasses to its face in the tip of its wing and pushes them on, then lowers the wing", () => {
    assert.isBelow(on, landed)
    const lifted = shown("glasses") ?? assert.fail("the glasses never show")
    assert.isAtLeast(lifted, shown("pageWing") ?? Infinity, "the wing comes first")
    // The point the wing holds them by stays in its tip, until they're on.
    const held: Point = [joints.glasses.x - 3.1, 71.3]
    const tip: Point = [61, 140.6]
    for (const t of every10ms.filter((t) => t >= lifted && t <= on)) {
      const glasses = throughSvg(svgTransform(at("glasses", t), "glasses"), held)
      const wing = throughSvg(svgTransform(at("pageWing", t), "pageWing"), tip)
      assert.isBelow(Math.hypot(glasses[0] - wing[0], glasses[1] - wing[1]), 3, `${t} ms`)
    }
    // Pushed up onto the eyes from below them, and left there.
    assert.isAbove(at("glasses", on - 90).y, 5)
    for (const t of every10ms.filter((t) => t > on - 90 && t <= on))
      assert.isBelow(at("glasses", t).y, at("glasses", t - 10).y, `pushed up at ${t} ms`)
    for (const t of every10ms.filter((t) => t >= on)) assert.deepStrictEqual(at("glasses", t), rest, `${t} ms`)
    assert.strictEqual(at("pageWing", landed - 10).rotate, 0, "the wing is down before the book lands")
  })

  it("drops the book from above Kotori's head, faster and faster, onto the ground in front of it, where it squashes and springs back", () => {
    const appears = shown("book") ?? assert.fail("the book never shows")
    assert.isAbove(appears, on, "once the glasses are on")
    const tuft = Math.min(...frontShapes.tuft.map((t) => t.cy - t.r))
    const foot = Math.max(...coordinates(readingShapes.book.spine).filter((_, i) => i % 2 === 1))
    assert.isBelow(foot + at("book", appears).y, tuft, "above its head")
    const falling = every10ms.filter((t) => t >= appears && t <= landed)
    for (const [i, t] of falling.entries()) {
      if (i < 2) continue
      const last = at("book", t).y - at("book", t - 10).y
      assert.isAbove(last, at("book", t - 10).y - at("book", t - 20).y, `${t} ms`)
    }
    const squash = every10ms.filter((t) => t > landed && t < duration)
    assert.isNotEmpty(squash)
    for (const t of squash) assert.strictEqual(at("book", t).y, 0, `${t} ms`)
    assert.isBelow(Math.min(...squash.map((t) => at("book", t).scaleY)), 0.9)
    assert.isAbove(Math.max(...squash.map((t) => at("book", t).scaleX)), 1.03)
    // The page Kotori turns shows only once the book has settled, so it doesn't fall apart from it.
    for (const t of every10ms.filter((t) => t < duration)) assert.strictEqual(at("page", t).opacity, 0, `${t} ms`)
  })

  it("watches the book come down, then blinks as it lands and opens the eyes it reads with", () => {
    const lookingUp = every10ms.find((t) => at("lookingEyes", t).y < 0) ?? assert.fail("never looks up")
    assert.isBelow(lookingUp, landed)
    for (const t of every10ms.filter((t) => t >= (shown("book") ?? 0) && t <= landed && t >= lookingUp + 100))
      assert.isAtLeast(at("lookingEyes", t).y, at("lookingEyes", t - 10).y, `${t} ms`)
    // The eyes it reads with move with the ones it looks with, under them, until it blinks.
    const gone = every10ms.find((t) => at("lookingEyes", t).opacity === 0) ?? assert.fail("the looking eyes never go")
    for (const t of every10ms.filter((t) => t < gone)) {
      const [eyes, looking] = [at("eyes", t), at("lookingEyes", t)]
      assert.deepStrictEqual([eyes.x, eyes.y, eyes.opacity], [looking.x, looking.y, looking.opacity], `${t} ms`)
    }
    assert.isAtLeast(gone, landed)
    assert.isBelow(gone, landed + 100, "as the book lands")
    const open = every10ms.find((t) => t > gone && at("eyes", t).opacity === 1) ?? assert.fail("never opens its eyes")
    assert.isAtLeast(open - gone, 100, "a blink, not a flicker")
    assert.isAtMost(open - gone, 160, "a blink, not a nap")
    assert.deepStrictEqual(at("eyes", open), rest)
  })
})

describe("the book landing", () => {
  const { duration } = clips.startReading
  const everyMs = Array.from({ length: duration + 1 }, (_, t) => t)
  const at = (part: Part, t: number) => poseAt("startReading", part, t)
  const landed = everyMs.find((t) => at("book", t).y === 0) ?? assert.fail("the book never lands")
  const { origin, puff, sparks, trail } = readingShapes.landing
  const shownByPart = new Map<Part, readonly number[]>()
  /** The times `part` shows, to the ms. */
  const shown = (part: Part) => {
    let times = shownByPart.get(part)
    if (times === undefined) {
      times = everyMs.filter((t) => at(part, t).opacity > 0)
      shownByPart.set(part, times)
    }
    return times
  }
  /** Where the middle of `part` is at `t`. */
  const centre = (part: Part, t: number): Point => [joints[part].x + at(part, t).x, joints[part].y + at(part, t).y]
  const spine = pointsOf(readingShapes.book.spine)
  const spineFoot = Math.max(...spine.map(([, y]) => y))

  it("throws everything up from the foot of the spine, where the book lands", () => {
    assert.strictEqual(joints.book.x, origin.x)
    assert.isAtMost(Math.abs(joints.book.y - origin.y), 5)
    for (const part of landingParts) assert.deepStrictEqual(joints[part], origin, part)
  })

  it("throws dust and sparks up only once the book has landed, and has them all gone as the clip ends, so the loop starts without them", () => {
    for (const part of landingParts) {
      const first = shown(part)[0] ?? assert.fail(`${part} never shows`)
      assert.isAtLeast(first, landed, part)
      assert.isBelow(first, landed + 200, `${part} comes with the landing`)
      assert.strictEqual(at(part, duration).opacity, 0, part)
    }
    // The dust bursts out the moment the book hits the ground.
    for (const part of puffParts) assert.strictEqual(shown(part)[0], landed, part)
    // The clip runs on only as long as something is still showing.
    assert.isTrue(
      landingParts.some((part) => at(part, duration - 50).opacity > 0),
      "something shows until near the end"
    )
  })

  it("puffs the dust out from behind the foot of the spine, rolling along the ground to each side, swelling and then fading", () => {
    const halfSpine = (Math.max(...spine.map(([x]) => x)) - Math.min(...spine.map(([x]) => x))) / 2
    for (const [part, outward] of [
      ["puff0", -1],
      ["puff1", 1]
    ] as const) {
      const times = shown(part)
      const first = times[0] ?? assert.fail(`${part} never shows`)
      // It starts small behind the spine and comes out well past it.
      assert.isBelow(1.62 * puff * at(part, first).scaleX, halfSpine, `${part} starts hidden behind the spine`)
      assert.isAbove(Math.abs(centre(part, times.at(-1) ?? first)[0] - 100), halfSpine * 3, `${part} rolls out`)
      for (const t of times.slice(1)) {
        assert.isAtLeast((centre(part, t)[0] - centre(part, t - 1)[0]) * outward, 0, `${part} rolls outward at ${t} ms`)
        assert.isAtMost(at(part, t).opacity, at(part, t - 1).opacity, `${part} only fades at ${t} ms`)
        assert.isAbove(centre(part, t)[1], 185, `${part} keeps to the ground at ${t} ms`)
      }
      assert.isAbove(Math.max(...times.map((t) => at(part, t).scaleX)), 1, `${part} swells`)
    }
    // Mirror images.
    for (const t of everyMs) {
      const [left, right] = [at("puff0", t), at("puff1", t)]
      assert.strictEqual(right.x + left.x, 0, `${t} ms`)
      assert.deepStrictEqual([right.y, right.scaleX, right.opacity], [left.y, left.scaleX, left.opacity], `${t} ms`)
    }
  })

  it("flies the sparks out one after another, to both sides, each in a low arc: up from the spine, over the top and down on the pages or beside the book", () => {
    let previous = -Infinity
    const sides = sparkParts.map((part) => {
      const times = shown(part)
      const first = times[0] ?? assert.fail(`${part} never shows`)
      const last = times.at(-1) ?? first
      assert.strictEqual(times.length, last - first + 1, `${part} flies once, without a break`)
      assert.isAbove(first, previous, `${part} flies after the one before`)
      previous = first
      near(centre(part, first), [origin.x, origin.y])
      const path = times.map((t) => centre(part, t))
      const end = path.at(-1) ?? assert.fail(`${part} has no path`)
      // Up first, then over the top of its arc and a little way down again.
      assert.isBelow(Math.min(...path.map(([, y]) => y)), end[1] - 3, `${part} comes over the top`)
      assert.isAbove(Math.abs(end[0] - 100), 40, `${part} comes down well clear of the spine`)
      // Its heading turns steadily one way, by a good deal, as it goes.
      const headings = path.slice(1).flatMap((p, i) => {
        const before = path[i] ?? p
        return Math.hypot(p[0] - before[0], p[1] - before[1]) > 0.05
          ? [Math.atan2(p[1] - before[1], p[0] - before[0])]
          : []
      })
      const turn = Math.sign(end[0] - 100) > 0 ? 1 : -1
      for (const [i, h] of headings.slice(1).entries()) {
        let change = h - (headings[i] ?? h)
        if (change > Math.PI) change -= 2 * Math.PI
        if (change < -Math.PI) change += 2 * Math.PI
        assert.isAtLeast(change * turn, -0.02, `${part} turns one way`)
      }
      let total = (headings.at(-1) ?? 0) - (headings[0] ?? 0)
      if (total * turn < 0) total += turn * 2 * Math.PI
      assert.isAbove(Math.abs(total), Math.PI / 3, `${part} curves`)
      // Gravity has it: it rises slower and slower, and falls faster and faster, but never far.
      const drop = (t: number) => centre(part, t)[1] - centre(part, t - 20)[1]
      for (let t = first + 40; t <= last; t += 20)
        assert.isAtLeast(drop(t), drop(t - 20) - 0.05, `${part} pulled down at ${t} ms`)
      assert.isAtLeast(Math.min(...path.map(([, y]) => y)), origin.y - 50, `${part} rises only a little`)
      assert.isAbove(drop(last), 1, `${part} is still falling as it winks out`)
      return Math.sign(end[0] - 100)
    })
    // Only a few, but at least two to each side.
    assert.isAtMost(sparkParts.length, 5)
    assert.isAtLeast(sides.filter((side) => side < 0).length, 2)
    assert.isAtLeast(sides.filter((side) => side > 0).length, 2)
    // In no set order: not simply turn and turn about.
    assert.isTrue(
      sides.some((side, i) => side === sides[i + 1]),
      "two in a row fly to the same side"
    )
  })

  it("throws no two sparks alike: they differ in size, colour, speed, height and spin", () => {
    const flights = sparkParts.map((part) => {
      const times = shown(part)
      const path = times.map((t) => centre(part, t))
      const poses = times.map((t) => at(part, t))
      return {
        size: sparks[part].r,
        color: sparks[part].color,
        span: times.length,
        top: Math.min(...path.map(([, y]) => y)),
        spin: (poses.at(-1)?.rotate ?? 0) - (poses[0]?.rotate ?? 0)
      }
    })
    const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values)
    assert.isAtLeast(Math.max(...flights.map((f) => f.size)), 1.75 * Math.min(...flights.map((f) => f.size)), "sizes")
    assert.isAtLeast(new Set(flights.map((f) => f.color)).size, 3, "colours")
    assert.isAtLeast(spread(flights.map((f) => f.span)), 200, "how long they fly, in ms")
    assert.isAtLeast(spread(flights.map((f) => f.top)), 20, "how high they go, in box units")
    assert.isTrue(
      flights.some((f) => f.spin > 0) && flights.some((f) => f.spin < 0),
      "some turn clockwise, some anticlockwise"
    )
    for (const [i, a] of flights.entries())
      for (const b of flights.slice(i + 1))
        assert.notDeepEqual([a.size, a.span, a.spin], [b.size, b.span, b.spin], "no two alike")
  })

  it("glints each spark as it flies: growing from nothing, turning, and winking out as it lands", () => {
    for (const part of sparkParts) {
      const poses = shown(part).map((t) => at(part, t))
      assert.isBelow(poses[0]?.scaleX ?? 1, 0.05, `${part} starts from nothing`)
      assert.isBelow(poses.at(-1)?.scaleX ?? 1, 0.05, `${part} winks out`)
      assert.strictEqual(Math.max(...poses.map((pose) => pose.scaleX)), 1, `${part} reaches its drawn size`)
      // One way or the other.
      assert.isAbove(Math.abs((poses.at(-1)?.rotate ?? 0) - (poses[0]?.rotate ?? 0)), 80, `${part} turns as it glints`)
    }
  })

  it("trails each spark, pointing back the way it came, never back past the foot of the spine, shrinking to nothing as it burns out", () => {
    const biggest = Math.max(...Object.values(sparks).map((spark) => spark.r))
    for (const [i, part] of sparkParts.entries()) {
      const tail = trailParts[i] ?? assert.fail(`no trail for ${part}`)
      assert.deepStrictEqual(shown(tail), shown(part), `${tail} shows with ${part}`)
      const times = shown(part)
      for (const t of times.filter((t, k) => k === 0 || k === times.length - 1 || t % 10 === 0)) {
        const label = `${tail} at ${t} ms`
        const now = centre(part, t)
        near(centre(tail, t), now)
        const pose = at(tail, t)
        const a = (pose.rotate * Math.PI) / 180
        const tip: Point = [
          now[0] - trail.length * pose.scaleX * Math.cos(a),
          now[1] - trail.length * pose.scaleX * Math.sin(a)
        ]
        assert.isAtMost(tip[1], spineFoot, label)
        // Pointing the way the spark is going.
        const next = centre(part, Math.min(t + 10, duration))
        if (Math.hypot(next[0] - now[0], next[1] - now[1]) > 0.5) {
          let off = Math.atan2(next[1] - now[1], next[0] - now[0]) - a
          off = Math.atan2(Math.sin(off), Math.cos(off))
          assert.isBelow(Math.abs(off), (12 * Math.PI) / 180, label)
        }
      }
      const lengths = times.map((t) => at(tail, t).scaleX)
      // As long and as wide as its spark is big.
      const scale = sparks[part].r / biggest
      assert.isAbove(Math.max(...lengths), 0.5 * scale, `${tail} streams out behind it`)
      assert.isAtMost(Math.max(...times.map((t) => at(tail, t).scaleY)), scale, `${tail} is as wide as ${part} is big`)
      assert.isBelow(lengths.at(-1) ?? 1, 0.05, `${tail} is gone as ${part} winks out`)
      const longest = lengths.indexOf(Math.max(...lengths))
      for (const [k, length] of lengths.slice(longest + 1).entries())
        assert.isAtMost(length, lengths[longest + k] ?? Infinity, `${tail} shrinks as ${part} burns out`)
    }
  })

  it("lands the sparks clear of Kotori, its wings and each other, and within the tile around a small Kotori", () => {
    const grow = sparklesFor(48).scaleX
    const clear = [frontShapes.body, ...readingShapes.wings].map(outline)
    for (const t of everyMs.filter((t) => t % 10 === 0)) {
      const glinting = sparkParts.flatMap((part) => {
        const pose = at(part, t)
        if (pose.opacity === 0) return []
        const middle = centre(part, t)
        const arm = sparks[part].r * pose.scaleX * grow
        const label = `${part} at ${t} ms`
        assert.isAtLeast(Math.min(...middle) - arm, -25, label)
        assert.isAtMost(Math.max(...middle) + arm, 225, label)
        // Where it comes down, as it winks out.
        if (t >= (shown(part).at(-1) ?? 0) - 150) {
          for (const shape of clear) {
            assert.isFalse(inside(middle, shape), label)
            assert.isAbove(Math.min(...shape.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1]))), arm, label)
          }
        }
        return [{ middle, arm }]
      })
      for (const [i, a] of glinting.entries()) {
        for (const b of glinting.slice(i + 1)) {
          if (Math.hypot(a.middle[0] - origin.x, a.middle[1] - origin.y) < 30) continue
          const apart = Math.hypot(a.middle[0] - b.middle[0], a.middle[1] - b.middle[1])
          assert.isAbove(apart, a.arm + b.arm, `apart at ${t} ms`)
        }
      }
    }
  })

  it("is drawn inside Kotori's box, so the app's canvas, which moves and scales with it, doesn't clip it", () => {
    // How far a puff reaches from its middle, in units of its size (see `puffPath`).
    assert.isAtMost(origin.y + 0.7 * puff, 200)
    assert.isAtMost(origin.y + Math.max(...Object.values(sparks).map((spark) => spark.r)), 200)
    assert.isAtLeast(origin.x - trail.length, 0)
    for (const [x, y] of pointsOf(trailPath(origin).replace(/A [\d. ]+ 0 0 1 /, "L "))) {
      assert.isAtLeast(Math.min(x, y), 0)
      assert.isAtMost(Math.max(x, y), 200)
    }
  })

  it("is drawn in the stills as the book lands, and not before or once it's settled", () => {
    const has = (t: number, d: string) => frameSvg("startReading", "reading", t).includes(d)
    // Each mark, in its colour, and a time it's on its way.
    const marks: [string, number][] = [
      [puffPath({ cx: origin.x, cy: origin.y, r: puff }), landed + 150],
      [trailPath(origin), landed + 150],
      ...sparkParts.map((part): [string, number] => {
        const { r, color } = sparks[part]
        const times = shown(part)
        return [
          `<path d="${sparklePath({ cx: origin.x, cy: origin.y, r })}" fill="${palette[color]}"/>`,
          times[Math.floor(times.length / 2)] ?? assert.fail(`${part} never shows`)
        ]
      })
    ]
    for (const [d, during] of marks) {
      assert.isFalse(has(landed - 10, d))
      assert.isFalse(has(duration, d))
      assert.isFalse(mascotSvg({ mood: "reading" }).includes(d))
      assert.isTrue(has(during, d))
    }
  })
})

describe("a pose", () => {
  const stretched: Pose = { x: 3, y: -4, rotate: -90, scaleX: 2, scaleY: 0.5, opacity: 1 }
  const skewed: Pose = { x: -7.5, y: 12.25, rotate: 37, scaleX: 0.8, scaleY: 1.35, opacity: 1 }

  it("turns and scales a part about its joint", () => {
    const { x, y } = joints.wing
    const at = (point: Point) => throughSvg(svgTransform(stretched, "wing"), point)
    // The joint only moves by the offset; a point beside it doubles its distance and turns a quarter anticlockwise.
    near(at([x, y]), [x + 3, y - 4])
    near(at([x + 10, y]), [x + 3, y - 24])
  })

  it("places a part the same way in the app as in stills", () => {
    const size = 120
    const k = size / 200
    const still = svgTransform(skewed, "wing")
    // Three non-collinear points pin down an affine transform; check with and without the bubble's headroom.
    for (const headroom of [0, thinkingShapes.headroom]) {
      const height = (200 + headroom) * k
      const view = viewTransform(skewed, "wing", size, headroom)
      const inView = (p: Point): Point => [p[0] * k, (p[1] + headroom) * k]
      for (const point of [
        [0, 0],
        [200, 0],
        [37, 151]
      ] as const) {
        near(throughView(view, size, inView(point), height), inView(throughSvg(still, point)))
      }
    }
  })

  it("places a piece of confetti the same way in the app as in stills", () => {
    const half = confetti.canvas / 2
    for (const size of [48, 150]) {
      const k = size / 200
      const { grow } = confettiFor(size)
      // The piece's view is its canvas, grown, at the top left of Kotori's; the point is in the canvas's units.
      const width = confetti.canvas * k * grow
      const still = pieceSvgTransform(skewed, grow)
      const view = pieceTransform(skewed, size, grow)
      for (const point of [
        [0, 0],
        [-half, -half],
        [half, -3]
      ] as const) {
        const inStill = throughSvg(still, point)
        near(
          throughView(view, width, [
            ((point[0] + half) * width) / confetti.canvas,
            ((point[1] + half) * width) / confetti.canvas
          ]),
          [inStill[0] * k, inStill[1] * k]
        )
      }
    }
  })
})

describe("Kotori's views and facing", () => {
  it("uses the side view by default for all moods except thinking and reading, and switches view or mirrors with facing", () => {
    assert.sameMembers([...frontMoods], ["thinking", "reading"])
    for (const mood of ["neutral", "happy", "sleepy", "celebrate", "oops"] as const) {
      const left = mascotSvg({ mood })
      assert.include(left, shapes.body, mood)
      assert.notInclude(left, frontShapes.body, mood)
      assert.notInclude(left, "scale(-1 1)", mood)

      const right = mascotSvg({ mood, facing: "right" })
      assert.include(right, shapes.body, mood)
      assert.include(right, 'transform="translate(200 0) scale(-1 1)"', mood)
    }
    for (const mood of ["neutral", "oops", "thinking", "reading"] as const) {
      const front = mascotSvg({ mood, facing: "front" })
      assert.include(front, frontShapes.body, mood)
      assert.notInclude(front, shapes.body, mood)
    }
    assert.include(mascotSvg({ mood: "thinking" }), frontShapes.body)
    assert.include(mascotSvg({ mood: "reading" }), frontShapes.body)
  })

  it("draws Kotori reading in glasses over the open book, with its own beak, and its wings over the book in place of the ones at its sides", () => {
    const reading = mascotSvg({ mood: "reading" })
    const { glasses, book } = readingShapes
    for (const d of [
      glasses.bridge,
      frontShapes.beak,
      ...readingShapes.wings,
      book.coverEdge,
      book.spine,
      ...book.pages
    ])
      assert.include(reading, d)
    for (const d of frontShapes.wings) assert.notInclude(reading, d)
  })

  it("renders the sweat drop on Kotori's temple in the front view of oops, inside the body and clear of the eye and cheek", () => {
    const body = outline(frontShapes.body)
    const [eye] = frontShapes.eyes
    const [cheek] = frontShapes.cheeks
    if (eye === undefined || cheek === undefined) throw new Error("missing front face shapes")
    // Sample points along the sweat drop's two quadratic curves (`M56 52 q 7 10 0 15 q -7 -5 0 -15 Z`).
    const nums = (frontShapes.sweat.match(/-?[\d.]+/g) ?? []).map(Number)
    const [x0 = 0, y0 = 0, dx1 = 0, dy1 = 0, dx2 = 0, dy2 = 0, dx3 = 0, dy3 = 0] = nums
    const tip: Point = [x0, y0]
    const bottom: Point = [x0 + dx2, y0 + dy2]
    const rightCtrl: Point = [x0 + dx1, y0 + dy1]
    const leftCtrl: Point = [bottom[0] + dx3, bottom[1] + dy3]
    const drop: Point[] = []
    for (let k = 0; k <= 16; k++) {
      const u = k / 16
      const v = 1 - u
      drop.push([
        v * v * tip[0] + 2 * v * u * rightCtrl[0] + u * u * bottom[0],
        v * v * tip[1] + 2 * v * u * rightCtrl[1] + u * u * bottom[1]
      ])
      drop.push([
        v * v * bottom[0] + 2 * v * u * leftCtrl[0] + u * u * tip[0],
        v * v * bottom[1] + 2 * v * u * leftCtrl[1] + u * u * tip[1]
      ])
    }
    for (const point of drop) {
      assert.isTrue(inside(point, body), `sweat drop point ${point.join()} inside body`)
      const inEye = Math.hypot((point[0] - eye.cx) / (eye.rx * 1.08), (point[1] - eye.cy) / (eye.ry * 1.08))
      const inCheek = Math.hypot((point[0] - cheek.cx) / cheek.rx, (point[1] - cheek.cy) / cheek.ry)
      assert.isAbove(inEye, 1, `sweat drop point ${point.join()} clear of eye`)
      assert.isAbove(inCheek, 1, `sweat drop point ${point.join()} clear of cheek`)
    }
    assert.include(mascotSvg({ mood: "oops", facing: "front" }), frontShapes.sweat)
    assert.include(mascotSvg({ mood: "oops" }), shapes.sweat)
  })
})
