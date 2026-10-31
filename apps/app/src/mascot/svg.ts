import { frontMoods, frontShapes, headroom, type Mood, palette, shapes, thinkingShapes } from "./geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  entrances,
  type Part,
  type Pose,
  poseAt,
  rest,
  settled,
  svgTransform
} from "./motion.ts"

/** `content` placed by `pose`. */
const placed = (pose: (part: Part) => Pose) => (name: Part, content: string) => {
  const at = pose(name)
  return `<g transform="${svgTransform(at, name)}" opacity="${at.opacity}">${content}</g>`
}

const circle = (c: { readonly cx: number; readonly cy: number; readonly r: number }, fill: string) =>
  `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${fill}"/>`

/** Kotori in three-quarter view in its 200×200 box, with each moving part placed by `pose`. */
const sideDrawing = (mood: Mood, pose: (part: Part) => Pose) => {
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

  return part(
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
  )
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

/** Kotori in `mood`, in whichever view it takes that mood in. */
const drawing = (mood: Mood, pose: (part: Part) => Pose) =>
  frontMoods.has(mood) ? frontDrawing(pose, mood === "thinking") : sideDrawing(mood, pose)

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

/** One frame of a clip, `t` ms in, on the sky, with room above the box for whatever reaches there. */
export const frameSvg = (name: ClipName, mood: Mood, t: number) => {
  const top = headroom(mood)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-top} 200 ${200 + top}" width="200" height="${200 + top}">
  <rect y="${-top}" width="200" height="${200 + top}" fill="${palette.sky}"/>
  ${drawing(mood, clipPose(name, mood, t))}
</svg>`
}

/**
 * A clip's frames on one sheet, read left to right, each marked with its time,
 * for checking an animation without running the app.
 */
export const framesSvg = (name: ClipName, mood: Mood, count = 12) => {
  const columns = 6
  const top = headroom(mood)
  const cell = { width: 220, height: 270 + top }
  const { duration } = clips[name]
  const frames = Array.from({ length: count }, (_, i) => {
    const t = Math.round((duration * i) / (count - 1))
    const x = (i % columns) * cell.width + 10
    const y = Math.floor(i / columns) * cell.height + 40 + top
    return `<g transform="translate(${x} ${y})">${drawing(mood, clipPose(name, mood, t))}<text x="100" y="222" text-anchor="middle" font-family="sans-serif" font-size="15" fill="${palette.ink}">${t} ms</text></g>`
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
