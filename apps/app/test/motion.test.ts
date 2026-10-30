import { assert, describe, it } from "vitest"
import { joints } from "../src/mascot/geometry.ts"
import {
  type ClipName,
  clips,
  entrances,
  type Part,
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
})
