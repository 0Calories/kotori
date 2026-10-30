import { type Mood, palette, shapes } from "./geometry.ts"

/** The mascot as an SVG document, for generating icons and splash images. */
export const mascotSvg = (options: { mood?: Mood; background?: string; padding?: number } = {}) => {
  const mood = options.mood ?? "curious"
  const pad = options.padding ?? 0
  const size = 200 + pad * 2
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${size} ${size}" width="${size}" height="${size}">
  ${options.background ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" fill="${options.background}"/>` : ""}
  <path d="${shapes.tail}" fill="${palette.ink}"/>
  ${foot(shapes.feet.back)}
  ${shapes.tuft.map((t) => `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r}" fill="${palette.cream}"/>`).join("")}
  <path d="${shapes.body}" fill="${palette.cream}"/>
  <path d="${shapes.shade}" fill="${palette.shade}"/>
  <path d="${shapes.belly}" fill="${palette.white}" fill-opacity="0.4"/>
  ${foot(shapes.feet.front)}
  <path d="${mood === "celebrate" ? shapes.wingUp : shapes.wing}" fill="${palette.ink}"/>
  ${shapes.cheeks.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="${palette.blush}"/>`).join("")}
  ${eyes}
  <path d="${shapes.beak}" fill="${palette.ink}"/>
</svg>`
}
