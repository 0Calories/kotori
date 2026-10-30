import { type Mood, palette, shapes } from "./geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  entrances,
  type Part,
  type Pose,
  poseAt,
  settled,
  svgTransform
} from "./motion.ts"

/** Kotori in its 200×200 box, with each moving part placed by `pose`. */
const drawing = (mood: Mood, pose: (part: Part) => Pose) => {
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
  const foot = (d: string) =>
    `<path d="${d}" stroke="${palette.ink}" stroke-width="${shapes.feet.width}" stroke-linecap="round"/>`
  const part = (name: Part, content: string) => {
    const placed = pose(name)
    return `<g transform="${svgTransform(placed, name)}" opacity="${placed.opacity}">${content}</g>`
  }

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
  ${part("eyes", eyes)}`
  )}`
  )
}

/** The mascot as an SVG document, for generating icons and splash images. */
export const mascotSvg = (options: { mood?: Mood; background?: string; padding?: number } = {}) => {
  const mood = options.mood ?? "curious"
  const pad = options.padding ?? 0
  const size = 200 + pad * 2

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${size} ${size}" width="${size}" height="${size}">
  ${options.background ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" fill="${options.background}"/>` : ""}
  ${drawing(mood, (part) => settled(mood, part))}
</svg>`
}

/** Where `part` is `t` ms into a clip played in `mood`; a clip that isn't the mood's entrance plays over the mood's pose, as in the app. */
const clipPose = (name: ClipName, mood: Mood, t: number) => (part: Part) =>
  entrances[mood] === name ? poseAt(name, part, t) : combine(settled(mood, part), poseAt(name, part, t))

/** One frame of a clip, `t` ms in, on the sky. */
export const frameSvg = (name: ClipName, mood: Mood, t: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="${palette.sky}"/>
  ${drawing(mood, clipPose(name, mood, t))}
</svg>`

/**
 * A clip's frames on one sheet, read left to right, each marked with its time,
 * for checking an animation without running the app.
 */
export const framesSvg = (name: ClipName, mood: Mood, count = 12) => {
  const columns = 6
  const cell = { width: 220, height: 270 }
  const { duration } = clips[name]
  const frames = Array.from({ length: count }, (_, i) => {
    const t = Math.round((duration * i) / (count - 1))
    const x = (i % columns) * cell.width + 10
    const y = Math.floor(i / columns) * cell.height + 40
    return `<g transform="translate(${x} ${y})">${drawing(mood, clipPose(name, mood, t))}<text x="100" y="222" text-anchor="middle" font-family="sans-serif" font-size="15" fill="${palette.ink}">${t} ms</text></g>`
  })
  const width = columns * cell.width
  const height = Math.ceil(count / columns) * cell.height

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${palette.sky}"/>
  ${frames.join("\n  ")}
</svg>`
}
