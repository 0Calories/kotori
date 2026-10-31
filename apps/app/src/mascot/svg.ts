import { confetti, frontMoods, frontShapes, headroom, type Mood, palette, shapes, thinkingShapes } from "./geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  confettiFor,
  entrances,
  type Part,
  pieceAt,
  pieceSvgTransform,
  type Pose,
  poseAt,
  rest,
  settled,
  type SparklePart,
  sparkleParts,
  sparklesFor,
  svgTransform
} from "./motion.ts"

/** `content` placed by `pose`, or by `at` when given. */
const placed =
  (pose: (part: Part) => Pose) =>
  (name: Part, content: string, at = pose(name)) =>
    `<g transform="${svgTransform(at, name)}" opacity="${at.opacity}">${content}</g>`

const circle = (c: { readonly cx: number; readonly cy: number; readonly r: number }, fill: string) =>
  `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${fill}"/>`

/**
 * Kotori in three-quarter view in its 200×200 box, with each moving part
 * placed by `pose`, and its sparkles beside it when it celebrates, as big as a
 * Kotori `size` pixels square draws them.
 */
const sideDrawing = (mood: Mood, pose: (part: Part) => Pose, size = 200) => {
  const { catchlight } = shapes
  const eyes =
    mood === "happy" || mood === "celebrate"
      ? shapes.eyes
          .map(
            (e) =>
              `<path d="M${e.cx - 7} ${e.cy + 2} Q ${e.cx} ${e.cy - 7} ${e.cx + 7} ${e.cy + 2}" fill="none" stroke="${palette.ink}" stroke-width="4" stroke-linecap="round"/>`
          )
          .join("")
      : shapes.eyes
          .map(
            (e) =>
              `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${palette.ink}"/><circle cx="${e.cx + catchlight.dx}" cy="${e.cy + catchlight.dy}" r="${catchlight.r}" fill="${palette.white}"/>`
          )
          .join("")
  const shut = shapes.eyes
    .map(
      (e) =>
        `<path d="M${e.cx - 7} ${e.cy + 1} Q ${e.cx} ${e.cy + 5} ${e.cx + 7} ${e.cy + 1}" fill="none" stroke="${palette.ink}" stroke-width="3.5" stroke-linecap="round"/>`
    )
    .join("")
  const foot = (d: string) =>
    `<path d="${d}" stroke="${palette.ink}" stroke-width="${shapes.feet.width}" stroke-linecap="round"/>`
  const part = placed(pose)
  const eyesPose = pose("eyes")
  const sparkle = (name: SparklePart) =>
    part(name, `<path d="${shapes.sparkles[name]}" fill="${palette.blush}"/>`, combine(pose(name), sparklesFor(size)))

  return `${part(
    "bird",
    `${part("tail", `<path d="${shapes.tail}" fill="${palette.ink}"/>`)}
  ${part("backFoot", foot(shapes.feet.back))}
  ${shapes.tuft.map((t) => `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r}" fill="${palette.cream}"/>`).join("")}
  <path d="${shapes.body}" fill="${palette.cream}"/>
  <path d="${shapes.shade}" fill="${palette.shade}"/>
  <path d="${shapes.belly}" fill="${palette.white}" fill-opacity="0.4"/>
  ${part("frontFoot", foot(shapes.feet.front))}
  ${part("wing", `<path d="${shapes.wing}" fill="${palette.ink}"/>`)}
  ${part(
    "face",
    `${shapes.cheeks.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="${palette.blush}"/>`).join("")}
  <path d="${shapes.beak}" fill="${palette.ink}"/>
  ${part("eyes", eyes)}
  <g transform="${svgTransform(eyesPose, "eyes")}" opacity="${1 - eyesPose.opacity}">${shut}</g>`
  )}`
  )}${mood === "celebrate" ? sparkleParts.map(sparkle).join("") : ""}`
}

/**
 * Kotori facing the viewer in its 200×200 box. It holds still; `thinking`
 * raises its wing to its chin and adds the thought bubble above the box, the
 * only part that moves, placed by `pose`.
 */
const frontDrawing = (pose: (part: Part) => Pose, thinking: boolean) => {
  const { catchlight, feet, wings } = frontShapes
  const foot = (d: string) =>
    `<path d="${d}" stroke="${palette.ink}" stroke-width="${feet.width}" stroke-linecap="round"/>`
  const part = placed(pose)
  const { trail, dots } = thinkingShapes

  const bird = `<path d="${wings[1]}" fill="${palette.ink}"/>
  ${thinking ? "" : `<path d="${wings[0]}" fill="${palette.ink}"/>`}
  ${frontShapes.tuft.map((t) => circle(t, palette.cream)).join("")}
  <path d="${frontShapes.body}" fill="${palette.cream}"/>
  <path d="${frontShapes.shade}" fill="${palette.shade}"/>
  <path d="${frontShapes.belly}" fill="${palette.white}" fill-opacity="0.4"/>
  ${foot(feet.left)}
  ${foot(feet.right)}
  ${frontShapes.cheeks.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="${palette.blush}"/>`).join("")}
  ${frontShapes.eyes
    .map(
      (e) =>
        `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${palette.ink}"/><circle cx="${e.cx + catchlight.dx}" cy="${e.cy + catchlight.dy}" r="${catchlight.r}" fill="${palette.white}"/>`
    )
    .join("")}
  <path d="${frontShapes.beak}" fill="${palette.ink}"/>`
  if (!thinking) return bird

  return `${bird}
  <path d="${thinkingShapes.chinWing}" fill="${palette.ink}"/>
  ${trail.map((t) => circle(t, palette.cream)).join("")}
  ${part(
    "bubble",
    `<path d="${thinkingShapes.bubble}" fill="${palette.cream}"/>
  ${part("dot0", circle(dots[0], palette.ink))}
  ${part("dot1", circle(dots[1], palette.ink))}
  ${part("dot2", circle(dots[2], palette.ink))}`
  )}`
}

/** Kotori in `mood`, in whichever view it takes that mood in, as a Kotori `size` pixels square draws it. */
const drawing = (mood: Mood, pose: (part: Part) => Pose, size = 200) =>
  frontMoods.has(mood) ? frontDrawing(pose, mood === "thinking") : sideDrawing(mood, pose, size)

/** The mascot as an SVG document, for generating icons and splash images. In moods that reach above the box, the image grows taller to fit. */
export const mascotSvg = (options: { mood?: Mood; background?: string; padding?: number } = {}) => {
  const mood = options.mood ?? "curious"
  const pad = options.padding ?? 0
  const size = 200 + pad * 2
  const top = -pad - headroom(mood)
  const height = size + headroom(mood)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${top} ${size} ${height}" width="${size}" height="${height}">
  ${options.background ? `<rect x="${-pad}" y="${top}" width="${size}" height="${height}" fill="${options.background}"/>` : ""}
  ${drawing(mood, (part) => settled(mood, part))}
</svg>`
}

/** Where `part` is `t` ms into a clip played in `mood`; a clip that isn't the mood's entrance plays over the mood's pose, as in the app. */
const clipPose = (name: ClipName, mood: Mood, t: number) => (part: Part) =>
  entrances[mood] === name ? poseAt(name, part, t) : combine(settled(mood, part), poseAt(name, part, t))

/** The confetti a clip has thrown `t` ms in, as a Kotori `size` pixels square throws it; it goes behind Kotori. */
const thrown = (name: ClipName, t: number, size: number) => {
  const { count, grow } = confettiFor(size)
  return (clips[name].confetti?.pieces ?? [])
    .slice(0, count)
    .map((piece, i) => {
      const pose = pieceAt(name, i, t)
      if (pose.opacity === 0) return ""
      const bit = confetti.bits[piece.shape]
      const color = palette[piece.color]
      const paint =
        bit.stroke === undefined
          ? `fill="${color}"`
          : `fill="none" stroke="${color}" stroke-width="${bit.stroke}" stroke-linecap="round"`
      return `<g transform="${pieceSvgTransform(pose, grow)}" opacity="${pose.opacity}"><path d="${bit.d}" ${paint}/></g>`
    })
    .join("")
}

/** How far past the box a frame shows, for the hop and the confetti, which go beyond it. */
const room = 40

/**
 * One frame of a clip, `t` ms in, on the sky, with confetti as a Kotori `size`
 * pixels square throws it, and room above the box for whatever reaches there.
 */
export const frameSvg = (name: ClipName, mood: Mood, t: number, size = 200) => {
  const top = room + headroom(mood)
  const width = 200 + room * 2
  const height = 200 + room + top
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-room} ${-top} ${width} ${height}" width="200" height="${Math.round((200 * height) / width)}">
  <rect x="${-room}" y="${-top}" width="${width}" height="${height}" fill="${palette.sky}"/>
  ${thrown(name, t, size)}
  ${drawing(mood, clipPose(name, mood, t), size)}
</svg>`
}

/**
 * A clip's frames on one sheet, read left to right, each marked with its time,
 * for checking an animation without running the app.
 */
export const framesSvg = (name: ClipName, mood: Mood, count = 12) => {
  const columns = 6
  const top = headroom(mood)
  const cell = { width: 200 + room * 2, height: 210 + room * 2 + top }
  const { duration } = clips[name]
  const frames = Array.from({ length: count }, (_, i) => {
    const t = Math.round((duration * i) / (count - 1))
    const x = (i % columns) * cell.width + room
    const y = Math.floor(i / columns) * cell.height + room + top
    return `<g transform="translate(${x} ${y})">${thrown(name, t, 200)}${drawing(mood, clipPose(name, mood, t))}<text x="100" y="${200 + room - 10}" text-anchor="middle" font-family="sans-serif" font-size="15" fill="${palette.ink}">${t} ms</text></g>`
  })
  const width = columns * cell.width
  const height = Math.ceil(count / columns) * cell.height

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${palette.sky}"/>
  ${frames.join("\n  ")}
</svg>`
}

/** Kotori facing the viewer as an SVG document, with `mascotSvg`'s background and padding options. */
export const mascotFrontSvg = (options: { background?: string; padding?: number } = {}) => {
  const pad = options.padding ?? 0
  const size = 200 + pad * 2

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${size} ${size}" width="${size}" height="${size}">
  ${options.background ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" fill="${options.background}"/>` : ""}
  ${frontDrawing(() => rest, false)}
</svg>`
}
