import {
  catchlightDx,
  confetti,
  type Facing,
  frontMoods,
  frontShapes,
  headroom,
  puffPath,
  type Mood,
  palette,
  readingShapes,
  shapes,
  sparklePath,
  thinkingShapes,
  trailPath
} from "./geometry.ts"
import {
  type ClipName,
  clips,
  combine,
  confettiFor,
  entrances,
  type Part,
  pieceAt,
  pieceSvgTransform,
  puffParts,
  type Pose,
  poseAt,
  rest,
  settled,
  type SparklePart,
  sparkleParts,
  sparklesFor,
  sparkParts,
  svgTransform,
  trailParts,
  type ZPart,
  zParts
} from "./motion.ts"

/** `content` placed by `pose`, or by `at` when given; nothing while it's faded out. */
const placed =
  (pose: (part: Part) => Pose) =>
  (name: Part, content: string, at = pose(name)) =>
    at.opacity === 0 ? "" : `<g transform="${svgTransform(at, name)}" opacity="${at.opacity}">${content}</g>`

const circle = (c: { readonly cx: number; readonly cy: number; readonly r: number }, fill: string) =>
  `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${fill}"/>`

const zSvg = (name: ZPart) => {
  const { d, stroke } = shapes.zs[name]
  return `<path d="${d}" fill="none" stroke="${palette.sky}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
}

type Face = {
  readonly eyes: readonly { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }[]
  /** `inward` mirrors `dx` on the eye right of the middle, so both catch the light on the beak's side. */
  readonly catchlight: { readonly dx: number; readonly dy: number; readonly r: number; readonly inward?: boolean }
}

const eyesSvg = (mood: Mood, face: Face) => {
  if (mood === "happy" || mood === "celebrate") {
    return face.eyes
      .map(
        (e) =>
          `<path d="M${e.cx - 7} ${e.cy + 2} Q ${e.cx} ${e.cy - 7} ${e.cx + 7} ${e.cy + 2}" fill="none" stroke="${palette.ink}" stroke-width="4" stroke-linecap="round"/>`
      )
      .join("")
  }
  if (mood === "sleepy") {
    return face.eyes
      .map(
        (e) =>
          `<path d="M${e.cx - 7} ${e.cy + 1} Q ${e.cx} ${e.cy + 5} ${e.cx + 7} ${e.cy + 1}" fill="none" stroke="${palette.ink}" stroke-width="3.5" stroke-linecap="round"/>`
      )
      .join("")
  }
  const scale = mood === "oops" ? 1.08 : 1
  const { catchlight } = face
  return face.eyes
    .map(
      (e) =>
        `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx * scale}" ry="${e.ry * scale}" fill="${palette.ink}"/><circle cx="${e.cx + catchlightDx(catchlight, e.cx)}" cy="${e.cy + catchlight.dy}" r="${catchlight.r}" fill="${palette.white}"/>`
    )
    .join("")
}

/** A page, its far edge and its print. */
const pageSvg = (side: 0 | 1) => {
  const { book } = readingShapes
  return `<path d="${book.pages[side]}" fill="${palette.paper}"/><path d="${book.edges[side]}" fill="none" stroke="${palette.shade}" stroke-width="2.2" stroke-linecap="round"/><path d="${book.print[side]}" fill="none" stroke="${palette.ink}" stroke-opacity="0.45" stroke-width="2.4" stroke-linecap="round"/>`
}

/**
 * Kotori reading, facing the viewer in its 200×200 box, with every part that
 * moves as it takes up the book and reads placed by `pose`. In the drawing,
 * the front view's wings and eyes are there too, under the ones it reads
 * with, and the book is in place; `startReading` fades them in and out. The
 * dust and sparks the book throws up as it lands grow beside a Kotori
 * `size` pixels square as celebrate's sparkles do.
 */
const readingDrawing = (pose: (part: Part) => Pose, size: number) => {
  const part = placed(pose)
  const { origin, puff, sparks } = readingShapes.landing
  const grown = (name: Part) => combine(pose(name), sparklesFor(size))
  const eyesPose = pose("eyes")
  const { glasses, book, wings } = readingShapes
  const stroke = `fill="none" stroke="${palette.frame}" stroke-width="${glasses.stroke}"`
  const foot = (d: string) =>
    `<path d="${d}" stroke="${palette.ink}" stroke-width="${frontShapes.feet.width}" stroke-linecap="round"/>`

  return `${part("foldedWing1", `<path d="${frontShapes.wings[1]}" fill="${palette.ink}"/>`)}
  ${part("foldedWing0", `<path d="${frontShapes.wings[0]}" fill="${palette.ink}"/>`)}
  ${frontShapes.tuft.map((t) => circle(t, palette.cream)).join("")}
  <path d="${frontShapes.body}" fill="${palette.cream}"/>
  <path d="${frontShapes.shade}" fill="${palette.shade}"/>
  <path d="${frontShapes.belly}" fill="${palette.white}" fill-opacity="0.4"/>
  ${foot(frontShapes.feet.left)}
  ${foot(frontShapes.feet.right)}
  <path d="${frontShapes.beak}" fill="${palette.ink}"/>
  ${part("cheeks", readingShapes.cheeks.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="${palette.blush}"/>`).join(""))}
  ${part("eyes", eyesSvg("reading", readingShapes))}
  <g transform="${svgTransform(eyesPose, "eyes")}" opacity="${1 - eyesPose.opacity}">${eyesSvg("sleepy", readingShapes)}</g>
  ${part("lookingEyes", eyesSvg("neutral", frontShapes))}
  ${part(
    "glasses",
    `${glasses.lenses.map((l) => `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r}" ${stroke}/>`).join("")}
  <path d="${glasses.bridge}" ${stroke} stroke-linecap="round"/>`
  )}
  ${part(
    "book",
    `<path d="${book.coverTop}" fill="${palette.leatherDark}"/>
  ${book.stacks.map((d) => `<path d="${d}" fill="${palette.paperEdge}"/>`).join("")}
  <path d="${book.stackLines}" fill="none" stroke="${palette.paperLine}" stroke-width="1.8" stroke-linecap="round"/>
  <path d="${book.coverEdge}" fill="${palette.leather}"/>
  ${pageSvg(0)}
  ${pageSvg(1)}
  <path d="${book.gutter}" fill="none" stroke="${palette.shade}" stroke-width="2.6"/>`
  )}
  ${part("page", pageSvg(0))}
  ${part("pageWing", `<path d="${wings[0]}" fill="${palette.ink}"/>`)}
  ${part("bookWing", `<path d="${wings[1]}" fill="${palette.ink}"/>`)}
  ${puffParts.map((name) => part(name, `<path d="${puffPath({ cx: origin.x, cy: origin.y, r: puff })}" fill="${palette.white}" stroke="${palette.paperLine}" stroke-width="1.6" stroke-linejoin="round"/>`, grown(name))).join("")}
  ${part("book", `<path d="${book.spine}" fill="${palette.leather}"/><path d="${book.spineHollow}" fill="${palette.leatherDark}"/>`)}
  ${sparkParts.map((name, i) => part(trailParts[i] ?? name, `<path d="${trailPath(origin)}" fill="${palette[sparks[name].color]}" fill-opacity="0.6"/>`, grown(trailParts[i] ?? name))).join("")}
  ${sparkParts.map((name) => part(name, `<path d="${sparklePath({ cx: origin.x, cy: origin.y, r: sparks[name].r })}" fill="${palette[sparks[name].color]}"/>`, grown(name))).join("")}`
}

/**
 * Kotori in three-quarter view in its 200×200 box, with each moving part
 * placed by `pose`, and its sparkles beside it when it celebrates, as big as a
 * Kotori `size` pixels square draws them. `facing === "right"` mirrors the
 * drawing horizontally about `x = 100`.
 */
const sideDrawing = (mood: Mood, pose: (part: Part) => Pose, size = 200, facing: "left" | "right" = "left") => {
  const foot = (d: string) =>
    `<path d="${d}" stroke="${palette.ink}" stroke-width="${shapes.feet.width}" stroke-linecap="round"/>`
  const part = placed(pose)
  const eyesPose = pose("eyes")
  const sparkle = (name: SparklePart) =>
    part(
      name,
      `<path d="${sparklePath(shapes.sparkles[name])}" fill="${palette.gold}"/>`,
      combine(pose(name), sparklesFor(size))
    )
  const z = (name: ZPart) => {
    const at = pose(name)
    return part(name, zSvg(name), facing === "right" ? { ...at, scaleX: -at.scaleX } : at)
  }
  const extra =
    mood === "oops"
      ? `<path d="${shapes.sweat}" fill="${palette.sky}"/>`
      : mood === "sleepy"
        ? zParts.map(z).join("")
        : ""

  const content = `${part(
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
  ${part("eyes", eyesSvg(mood, shapes))}
  <g transform="${svgTransform(eyesPose, "eyes")}" opacity="${1 - eyesPose.opacity}">${eyesSvg("sleepy", shapes)}</g>`
  )}`
  )}${mood === "celebrate" ? sparkleParts.map(sparkle).join("") : ""}${extra}`

  return facing === "right" ? `<g transform="translate(200 0) scale(-1 1)">${content}</g>` : content
}

/**
 * Kotori facing the viewer in its 200×200 box. It holds its pose while blinking
 * in open-eyed moods; `thinking` raises its wing to its chin and adds the
 * thought bubble above the box, placed by `pose`.
 */
const frontDrawing = (mood: Mood, pose: (part: Part) => Pose) => {
  const { feet, wings } = frontShapes
  const foot = (d: string) =>
    `<path d="${d}" stroke="${palette.ink}" stroke-width="${feet.width}" stroke-linecap="round"/>`
  const part = placed(pose)
  const eyesPose = pose("eyes")
  const thinking = mood === "thinking"
  const { trail, dots } = thinkingShapes
  const extra =
    mood === "oops"
      ? `<path d="${frontShapes.sweat}" fill="${palette.sky}"/>`
      : mood === "sleepy"
        ? zParts.map((name) => part(name, zSvg(name))).join("")
        : ""

  const bird = `<path d="${wings[1]}" fill="${palette.ink}"/>
  ${thinking ? "" : `<path d="${wings[0]}" fill="${palette.ink}"/>`}
  ${frontShapes.tuft.map((t) => circle(t, palette.cream)).join("")}
  <path d="${frontShapes.body}" fill="${palette.cream}"/>
  <path d="${frontShapes.shade}" fill="${palette.shade}"/>
  <path d="${frontShapes.belly}" fill="${palette.white}" fill-opacity="0.4"/>
  ${foot(feet.left)}
  ${foot(feet.right)}
  ${frontShapes.cheeks.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="${palette.blush}"/>`).join("")}
  ${part("eyes", eyesSvg(mood, frontShapes))}
  <g transform="${svgTransform(eyesPose, "eyes")}" opacity="${1 - eyesPose.opacity}">${eyesSvg("sleepy", frontShapes)}</g>
  <path d="${frontShapes.beak}" fill="${palette.ink}"/>${extra ? `\n  ${extra}` : ""}`
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

/** Kotori in `mood` and `facing`, as a Kotori `size` pixels square draws it. */
const drawing = (mood: Mood, pose: (part: Part) => Pose, size = 200, facing: Facing = "left") =>
  mood === "reading"
    ? readingDrawing(pose, size)
    : facing === "front" || frontMoods.has(mood)
      ? frontDrawing(mood, pose)
      : sideDrawing(mood, pose, size, facing)

/** The mascot as an SVG document, for generating icons and splash images. In moods that reach above the box, the image grows taller to fit. */
export const mascotSvg = (options: { mood?: Mood; facing?: Facing; background?: string; padding?: number } = {}) => {
  const mood = options.mood ?? "neutral"
  const facing = options.facing ?? "left"
  const pad = options.padding ?? 0
  const size = 200 + pad * 2
  const top = -pad - headroom(mood)
  const height = size + headroom(mood)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${top} ${size} ${height}" width="${size}" height="${height}">
  ${options.background ? `<rect x="${-pad}" y="${top}" width="${size}" height="${height}" fill="${options.background}"/>` : ""}
  ${drawing(mood, (part) => settled(mood, part), 200, facing)}
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

/** Moods whose own marks are `palette.sky` sit on white in preview frames so those marks show. */
const backdrop = (mood: Mood) => (mood === "sleepy" || mood === "oops" ? palette.white : palette.sky)

/**
 * One frame of a clip, `t` ms in, with confetti as a Kotori `size` pixels
 * square throws it, and room above the box for whatever reaches there.
 */
export const frameSvg = (name: ClipName, mood: Mood, t: number, size = 200) => {
  const top = room + headroom(mood)
  const width = 200 + room * 2
  const height = 200 + room + top
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-room} ${-top} ${width} ${height}" width="200" height="${Math.round((200 * height) / width)}">
  <rect x="${-room}" y="${-top}" width="${width}" height="${height}" fill="${backdrop(mood)}"/>
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
  <rect width="${width}" height="${height}" fill="${backdrop(mood)}"/>
  ${frames.join("\n  ")}
</svg>`
}

/** Kotori facing the viewer as an SVG document, with `mascotSvg`'s background and padding options. */
export const mascotFrontSvg = (options: { background?: string; padding?: number } = {}) => {
  const pad = options.padding ?? 0
  const size = 200 + pad * 2

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${size} ${size}" width="${size}" height="${size}">
  ${options.background ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" fill="${options.background}"/>` : ""}
  ${frontDrawing("neutral", () => rest)}
</svg>`
}
