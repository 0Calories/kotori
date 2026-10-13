import { centering, type Mood, palette, shapes } from "./geometry.ts"

/** The mascot as an SVG document, for generating icons and splash images. */
export const mascotSvg = (options: { mood?: Mood; background?: string; padding?: number } = {}) => {
  const mood = options.mood ?? "curious"
  const pad = options.padding ?? 0
  const size = 200 + pad * 2
  const { body } = shapes
  const eyes = mood === "happy" || mood === "celebrate"
    ? shapes.eyes.map((e) =>
      `<path d="M${e.cx - 7} ${e.cy + 2} Q ${e.cx} ${e.cy - 7} ${e.cx + 7} ${e.cy + 2}" fill="none" stroke="${palette.ink}" stroke-width="4" stroke-linecap="round"/>`
    ).join("")
    : shapes.eyes.map((e) =>
      `<circle cx="${e.cx}" cy="${e.cy}" r="7" fill="${palette.ink}"/><circle cx="${e.cx + 2.5}" cy="${e.cy - 2.5}" r="2.3" fill="${palette.white}"/>`
    ).join("")
  const wing = mood === "celebrate"
    ? `<path d="${shapes.wingUp}" fill="${palette.ink}"/><path d="${shapes.wingUpShoulder}" fill="${palette.rose}"/>`
    : `<path d="${shapes.wing}" fill="${palette.ink}"/><path d="${shapes.wingShoulder}" fill="${palette.rose}"/><path d="${shapes.wingEdge}" stroke="${palette.white}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.85"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="body" cx="42%" cy="36%" r="70%">
      <stop offset="0%" stop-color="${palette.white}"/>
      <stop offset="72%" stop-color="${palette.cream}"/>
      <stop offset="100%" stop-color="${palette.shade}"/>
    </radialGradient>
  </defs>
  ${options.background ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" fill="${options.background}"/>` : ""}
  <g transform="translate(${centering.x} ${centering.y})">
  <path d="${shapes.tail}" fill="${palette.ink}"/>
  <path d="${shapes.tailHighlight}" stroke="${palette.white}" stroke-opacity="0.35" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="${shapes.feet}" stroke="${palette.ink}" stroke-width="3.5" stroke-linecap="round"/>
  <ellipse cx="${body.cx}" cy="${body.cy}" rx="${body.rx}" ry="${body.ry}" fill="url(#body)" stroke="${palette.outline}" stroke-width="2"/>
  <path d="${shapes.tuft}" fill="none" stroke="${palette.outline}" stroke-width="2.5" stroke-linecap="round"/>
  ${wing}
  ${shapes.cheeks.map((c) => `<ellipse cx="${c.cx}" cy="${c.cy}" rx="${c.rx}" ry="${c.ry}" fill="${palette.blush}" opacity="0.6"/>`).join("")}
  ${eyes}
  <path d="${shapes.beak}" fill="${palette.ink}" stroke="${palette.ink}" stroke-width="2" stroke-linejoin="round"/>
  </g>
</svg>`
}
