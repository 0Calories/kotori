import { assert, describe, it } from "vitest"
import { confetti, joints, type Mood, shapes, thinkingShapes } from "../src/mascot/geometry.ts"
import {
  type ClipName,
  clips,
  confettiFor,
  entrances,
  idles,
  loops,
  type Part,
  pieceAt,
  pieceSvgTransform,
  pieceTransform,
  type Pose,
  poseAt,
  rest,
  settled,
  sparkleParts,
  sparklesFor,
  svgTransform,
  viewTransform
} from "../src/mascot/motion.ts"

const names = Object.keys(clips) as ClipName[]
const parts = Object.keys(joints) as Part[]
/** The parts of Kotori itself, not the sparkles beside it. */
const kotori = parts.filter((part) => !(sparkleParts as readonly Part[]).includes(part))

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

/** A point through an SVG transform attribute, last function first. */
const throughSvg = (transform: string, point: Point): Point => {
  let p = point
  for (const match of [...transform.matchAll(/(\w+)\(([^)]*)\)/g)].toReversed()) {
    const [a = 0, b = a] = (match[2] ?? "").split(" ").map(Number)
    if (match[1] === "translate") p = [p[0] + a, p[1] + b]
    else if (match[1] === "scale") p = [p[0] * a, p[1] * b]
    else if (match[1] === "rotate") p = turn(p, a)
  }
  return p
}

describe("Kotori's clips", () => {
  it("start each mood's entrance from the drawing, so no part jumps as the mood changes", () => {
    for (const name of Object.values(entrances)) {
      for (const part of kotori) assert.deepStrictEqual(poseAt(name, part, 0), rest, `${name}: ${part}`)
    }
    // The sparkles come with the mood, so they start out of sight.
    for (const part of sparkleParts) assert.strictEqual(poseAt("celebrate", part, 0).opacity, 0, part)
  })

  it("start and end each loop on the drawing, so it plays over a mood's pose without a jump each time round", () => {
    for (const name of Object.values(loops)) {
      for (const part of parts) {
        assert.deepStrictEqual(poseAt(name, part, 0), rest, `${name}: ${part} at the start`)
        assert.deepStrictEqual(poseAt(name, part, clips[name].duration), rest, `${name}: ${part} at the end`)
      }
    }
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

  it("fold the wing back down once Kotori has celebrated, and leave the sparkles as drawn", () => {
    for (const part of parts) assert.deepStrictEqual(poseAt("celebrate", part, Infinity), rest, part)
  })

  it("leave Kotori still while it thinks: no entrance or blink, and only the thought bubble and its dots move", () => {
    assert.isUndefined(entrances.thinking)
    assert.isUndefined(idles.thinking)
    for (const part of parts) assert.deepStrictEqual(settled("thinking", part), rest, part)
    assert.sameMembers(Object.keys(clips.thinking.tracks), ["bubble", "dot0", "dot1", "dot2"])
  })

  it("blink only in moods whose eyes are open, and twinkle only where there are sparkles", () => {
    const shut: Mood[] = ["happy", "celebrate", "sleepy"]
    for (const mood of Object.keys(idles) as Mood[])
      assert.strictEqual(idles[mood] === "blink", !shut.includes(mood), mood)
    assert.strictEqual(idles.celebrate, "twinkle")
    assert.sameMembers(Object.keys(clips.twinkle.tracks), [...sparkleParts])
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

/** A sparkle's points, its tips and the corners between them, from its path of straight lines. */
const starPoints = (d: string) => {
  const numbers = (d.match(/-?[\d.]+/g) ?? []).map(Number)
  const points: Point[] = [[numbers[0] ?? 0, numbers[1] ?? 0]]
  for (let i = 2; i + 1 < numbers.length; i += 2) {
    const [x, y] = points.at(-1) ?? [0, 0]
    points.push([x + (numbers[i] ?? 0), y + (numbers[i + 1] ?? 0)])
  }
  return points
}

describe("celebrate's sparkles", () => {
  const { duration } = clips.celebrate
  const every10ms = Array.from({ length: duration / 10 + 1 }, (_, i) => i * 10)
  const pieces = clips.celebrate.confetti?.pieces ?? []
  const centre = (part: Part, pose: Pose): Point => [joints[part].x + pose.x, joints[part].y + pose.y]
  /** When `part` first shows, to the ms. */
  const out = (part: Part) => {
    for (let t = 0; t <= duration; t++) if (poseAt("celebrate", part, t).opacity > 0) return t
    return assert.fail(`${part} never shows`)
  }

  it("come off the tip of the raised wing as its last wave turns, so they don't appear out of thin air", () => {
    for (const part of sparkleParts) {
      const t = out(part)
      const wing = poseAt("celebrate", "wing", t)
      const placed = outline(shapes.wing).map((point) =>
        throughSvg(svgTransform(poseAt("celebrate", "bird", t), "bird"), throughSvg(svgTransform(wing, "wing"), point))
      )
      const at = centre(part, poseAt("celebrate", part, t))
      assert.isTrue(inside(at, placed), part)
      assert.isAbove(Math.hypot(at[0] - joints.wing.x, at[1] - joints.wing.y), 45, part)
      assert.isBelow(wing.rotate, -90, part)
      // The wave's last stroke: the wing is on its way back down within a few frames.
      assert.isAbove(poseAt("celebrate", "wing", t + 120).rotate, wing.rotate, part)
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

  it("pop out bigger than they rest, and have settled by the time the wing has", () => {
    for (const part of sparkleParts) {
      assert.isAbove(Math.max(...every10ms.map((t) => poseAt("celebrate", part, t).scaleX)), 1.2, part)
      assert.deepStrictEqual(poseAt("celebrate", part, duration), rest, part)
    }
  })

  it("twinkle where they are, and end looking as they started", () => {
    for (const part of sparkleParts) {
      const end = poseAt("twinkle", part, clips.twinkle.duration)
      assert.deepStrictEqual({ ...end, rotate: 0 }, rest, part)
      assert.strictEqual(end.rotate % 90, 0, part)
      for (let t = 0; t <= clips.twinkle.duration; t += 10) {
        const pose = poseAt("twinkle", part, t)
        assert.deepStrictEqual([pose.x, pose.y, pose.opacity], [0, 0, 1], `${part} at ${t} ms`)
      }
      // That's because a four-point star looks the same turned a quarter turn about its middle.
      const points = starPoints(shapes.sparkles[part])
      const turned = points.map((point) => throughSvg(svgTransform({ ...rest, rotate: 90 }, part), point))
      for (const point of turned) assert.isTrue(points.some((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < 1e-9))
    }
  })

  it("stay clear of Kotori's face, and within the tile around a small Kotori, as they come out and twinkle", () => {
    const face = [
      ...shapes.eyes.flatMap((e): Point[] => [
        [e.cx - e.rx, e.cy - e.ry],
        [e.cx + e.rx, e.cy + e.ry]
      ]),
      ...shapes.cheeks.flatMap((c): Point[] => [
        [c.cx - c.rx, c.cy - c.ry],
        [c.cx + c.rx, c.cy + c.ry]
      ]),
      ...outline(shapes.beak)
    ]
    const grow = sparklesFor(48).scaleX
    const moments = [
      ...every10ms.map((t) => (part: Part) => poseAt("celebrate", part, t)),
      ...Array.from(
        { length: clips.twinkle.duration / 10 + 1 },
        (_, i) => (part: Part) => poseAt("twinkle", part, i * 10)
      )
    ]
    for (const [m, poseOf] of moments.entries()) {
      const box = face.map((point) => throughSvg(svgTransform(poseOf("bird"), "bird"), point))
      const left = Math.min(...box.map(([x]) => x))
      const right = Math.max(...box.map(([x]) => x))
      const top = Math.min(...box.map(([, y]) => y))
      for (const part of sparkleParts) {
        const pose = poseOf(part)
        if (pose.opacity === 0) continue
        const [x, y] = centre(part, pose)
        const arm =
          Math.max(
            ...starPoints(shapes.sparkles[part]).map(([px, py]) => Math.hypot(px - joints[part].x, py - joints[part].y))
          ) *
          pose.scaleX *
          grow
        assert.isTrue(y + arm < top || x + arm < left || x - arm > right, `${part} at moment ${m}`)
        // The tile is 60 px around a 48 px Kotori, so it reaches 25 box units past the box.
        assert.isAtLeast(Math.min(x, y) - arm, -25, `${part} at moment ${m}`)
        assert.isAtMost(Math.max(x, y) + arm, 225, `${part} at moment ${m}`)
      }
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

describe("a pose", () => {
  const stretched: Pose = { x: 3, y: -4, rotate: -90, scaleX: 2, scaleY: 0.5, opacity: 1 }

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
    const poses = [
      rest,
      stretched,
      ...[130, 370, 660, 1300].flatMap((t) => parts.map((part) => poseAt("celebrate", part, t))),
      ...[60, 300, 600].flatMap((t) => parts.map((part) => poseAt("thinking", part, t)))
    ]
    // The thought bubble's canvas reaches above the box.
    for (const headroom of [0, thinkingShapes.headroom]) {
      const height = (200 + headroom) * k
      for (const part of parts) {
        const points: Point[] = [
          [0, 0],
          [200, 0],
          [37, 151],
          [140, -50],
          [joints[part].x, joints[part].y]
        ]
        for (const pose of poses) {
          for (const point of points) {
            const inStill = throughSvg(svgTransform(pose, part), point)
            // A point's place in the canvas, which starts `headroom` units above the box.
            const inView = (p: Point): Point => [p[0] * k, (p[1] + headroom) * k]
            near(throughView(viewTransform(pose, part, size, headroom), size, inView(point), height), inView(inStill))
          }
        }
      }
    }
  })

  it("places a piece of confetti the same way in the app as in stills", () => {
    const half = confetti.canvas / 2
    const poses = [
      rest,
      stretched,
      ...[300, 520, 900].flatMap((t) =>
        (clips.celebrate.confetti?.pieces ?? []).map((_, i) => pieceAt("celebrate", i, t))
      )
    ]
    for (const size of [48, 150]) {
      const k = size / 200
      const { grow } = confettiFor(size)
      // The piece's view is its canvas, grown, at the top left of Kotori's; the point is in the canvas's units.
      const width = confetti.canvas * k * grow
      const points: Point[] = [
        [0, 0],
        [-half, -half],
        [half, -3],
        [2.5, half]
      ]
      for (const pose of poses) {
        for (const point of points) {
          const inStill = throughSvg(pieceSvgTransform(pose, grow), point)
          near(
            throughView(pieceTransform(pose, size, grow), width, [
              ((point[0] + half) * width) / confetti.canvas,
              ((point[1] + half) * width) / confetti.canvas
            ]),
            [inStill[0] * k, inStill[1] * k]
          )
        }
      }
    }
  })
})
