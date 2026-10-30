import { assert, describe, it } from "vitest"
import { confetti, joints, shapes } from "../src/mascot/geometry.ts"
import {
  type ClipName,
  clips,
  confettiFor,
  entrances,
  extrasAt,
  type Part,
  pieceAt,
  pieceSvgTransform,
  pieceTransform,
  type Pose,
  poseAt,
  rest,
  svgTransform,
  viewTransform
} from "../src/mascot/motion.ts"

const names = Object.keys(clips) as ClipName[]
const parts = Object.keys(joints) as Part[]

type Point = readonly [number, number]

const near = (actual: Point, expected: Point) => {
  assert.closeTo(actual[0], expected[0], 1e-9)
  assert.closeTo(actual[1], expected[1], 1e-9)
}

const turn = ([x, y]: Point, degrees: number): Point => {
  const a = (degrees * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

/** A point through a React Native transform in a view `size` pixels square: about the view's centre, last step first. */
const throughView = (transform: ReturnType<typeof viewTransform>, size: number, point: Point): Point => {
  let p: Point = [point[0] - size / 2, point[1] - size / 2]
  for (const step of transform.toReversed()) {
    if (step.translateX !== undefined) p = [p[0] + step.translateX, p[1]]
    else if (step.translateY !== undefined) p = [p[0], p[1] + step.translateY]
    else if (step.scaleX !== undefined) p = [p[0] * step.scaleX, p[1]]
    else if (step.scaleY !== undefined) p = [p[0], p[1] * step.scaleY]
    else if (step.rotate !== undefined) p = turn(p, Number.parseFloat(step.rotate))
  }
  return [p[0] + size / 2, p[1] + size / 2]
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
      for (const part of parts) assert.deepStrictEqual(poseAt(name, part, 0), rest, `${name}: ${part}`)
    }
  })

  it("keep their keys in order and within the clip", () => {
    for (const name of names) {
      const tracks = Object.values(clips[name].tracks).flatMap((track) => Object.values(track ?? {}))
      for (const keys of [...tracks, clips[name].extras]) {
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
    for (const part of parts) assert.deepStrictEqual(poseAt("celebrate", part, Infinity), rest, part)
  })

  it("shut the eyes for the whole blink, then open them, since it plays over everything else", () => {
    assert.strictEqual(poseAt("blink", "eyes", 0).opacity, 0)
    assert.strictEqual(poseAt("blink", "eyes", clips.blink.duration - 1).opacity, 0)
    for (const part of parts) assert.deepStrictEqual(poseAt("blink", part, clips.blink.duration), rest, part)
  })

  it("ease between keys", () => {
    // Halfway to an `out` key, a value has gone seven eighths of the way.
    assert.closeTo(poseAt("thinking", "eyes", 140).x, -2.5 * 0.875, 1e-9)
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

  it("keeps the sparkles back until it's fading, and shows them once Kotori has settled", () => {
    for (const t of every10ms) {
      if (indices.some((i) => pieceAt("celebrate", i, t).opacity === 1)) {
        assert.strictEqual(extrasAt("celebrate", t), 0, `${t} ms`)
      }
    }
    assert.strictEqual(extrasAt("celebrate", Infinity), 1)
    // A clip that doesn't fade the extras, like thinking's glance, leaves its bubbles showing throughout.
    assert.strictEqual(extrasAt("thinking", 0), 1)
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
      ...[130, 370, 660].flatMap((t) => parts.map((part) => poseAt("celebrate", part, t)))
    ]
    for (const part of parts) {
      const points: Point[] = [
        [0, 0],
        [200, 0],
        [37, 151],
        [joints[part].x, joints[part].y]
      ]
      for (const pose of poses) {
        for (const point of points) {
          const inStill = throughSvg(svgTransform(pose, part), point)
          near(throughView(viewTransform(pose, part, size), size, [point[0] * k, point[1] * k]), [
            inStill[0] * k,
            inStill[1] * k
          ])
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
