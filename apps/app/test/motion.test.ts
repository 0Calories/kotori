import { assert, describe, it } from "vitest"
import { joints, thinkingShapes } from "../src/mascot/geometry.ts"
import {
  type ClipName,
  clips,
  entrances,
  loops,
  type Part,
  type Pose,
  poseAt,
  rest,
  settled,
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
  it("start each part of a mood's entrance from the drawing or hidden, so nothing showing jumps as the mood changes", () => {
    for (const name of Object.values(entrances)) {
      for (const part of parts) {
        const start = poseAt(name, part, 0)
        if (start.opacity !== 0) assert.deepStrictEqual(start, rest, `${name}: ${part}`)
      }
    }
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
      for (const track of Object.values(clips[name].tracks)) {
        for (const keys of Object.values(track ?? {})) {
          const times = (keys ?? []).map(([ms]) => ms)
          assert.deepStrictEqual(
            times,
            [...times].sort((a, b) => a - b),
            name
          )
          assert.isAtMost(times.at(-1) ?? 0, clips[name].duration, name)
        }
      }
    }
  })

  it("land Kotori back on its feet, so no mood's pose hangs mid-hop", () => {
    for (const name of Object.values(entrances)) assert.deepStrictEqual(poseAt(name, "bird", Infinity), rest, name)
  })

  it("fold the wing back down once Kotori has celebrated", () => {
    for (const part of parts) assert.deepStrictEqual(poseAt("celebrate", part, Infinity), rest, part)
  })

  it("leave Kotori thinking with its wing at its chin under a full thought bubble", () => {
    assert.strictEqual(settled("thinking", "sideWing").opacity, 0)
    for (const part of parts.filter((p) => p !== "sideWing")) {
      assert.deepStrictEqual(settled("thinking", part), rest, part)
    }
  })

  it("grow the thought bubble from the head up: each puff, then the bubble, then each dot", () => {
    const appears = (part: Part) => {
      let t = 0
      while (poseAt("thinking", part, t).opacity === 0) t++
      return t
    }
    const order: Part[] = ["trail0", "trail1", "bubble", "dot0", "dot1", "dot2"]
    const times = order.map(appears)
    assert.deepStrictEqual(
      times,
      [...times].sort((a, b) => a - b),
      order.join(", ")
    )
    assert.strictEqual(new Set(times).size, order.length)
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
      ...[130, 370, 660].flatMap((t) => parts.map((part) => poseAt("celebrate", part, t))),
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
})
