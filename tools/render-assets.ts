/**
 * Renders the mascot into the app's native icons, splash image, favicons,
 * PWA icons, and Open Graph preview thumbnail.
 * Usage: pnpm assets
 */
import { Resvg } from "@resvg/resvg-js"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { palette } from "../apps/app/src/mascot/geometry.ts"
import { mascotFrontSvg, mascotSvg } from "../apps/app/src/mascot/svg.ts"

const root = join(import.meta.dirname, "..")
const assetsOut = join(root, "apps", "app", "assets")
const publicOut = join(root, "apps", "app", "public")
mkdirSync(assetsOut, { recursive: true })
mkdirSync(publicOut, { recursive: true })

/** Resolves a font file from either `apps/app/node_modules` or hoisted root `node_modules`, failing loudly if missing. */
const resolveFontFile = (...segments: ReadonlyArray<string>): string => {
  const candidates = [join(root, "apps", "app", "node_modules", ...segments), join(root, "node_modules", ...segments)]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    throw new Error(`Missing font asset for OG thumbnail: ${segments.join("/")} (checked ${candidates.join(", ")})`)
  }
  return found
}

const fontFiles = [
  resolveFontFile("@expo-google-fonts", "gabarito", "800ExtraBold", "Gabarito_800ExtraBold.ttf"),
  resolveFontFile("@expo-google-fonts", "gabarito", "500Medium", "Gabarito_500Medium.ttf"),
  resolveFontFile("@expo-google-fonts", "murecho", "500Medium", "Murecho_500Medium.ttf")
]

const renderPngBuffer = (svg: string, width: number, withFonts = false): Buffer =>
  Buffer.from(
    new Resvg(svg, {
      fitTo: { mode: "width", value: width },
      ...(withFonts ? { font: { fontFiles, loadSystemFonts: false } } : {})
    })
      .render()
      .asPng()
  )

const renderPng = (dir: string, file: string, svg: string, width: number, withFonts = false) => {
  writeFileSync(join(dir, file), renderPngBuffer(svg, width, withFonts))
  console.log(`wrote ${file} (${width}px)`)
}

const writeSvg = (dir: string, file: string, svg: string) => {
  writeFileSync(join(dir, file), `${svg}\n`)
  console.log(`wrote ${file}`)
}

/** Packs PNG frames into a standard multi-resolution `.ico` container. */
const encodeIco = (images: ReadonlyArray<{ readonly size: number; readonly png: Buffer }>): Buffer => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // icon type
  header.writeUInt16LE(images.length, 4)

  const entries: Buffer[] = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...images.map((img) => img.png)])
}

const stripXmlSvgWrapper = (svg: string) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")

/** 1200×630 Open Graph / social thumbnail matching the Sora palette. */
const ogImageSvg = () => {
  const mascotInner = stripXmlSvgWrapper(mascotSvg({ mood: "happy", padding: 0 }))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F6FAFC"/>
      <stop offset="100%" stop-color="#E5F2FC"/>
    </linearGradient>
    <linearGradient id="badge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#A1CBE8"/>
      <stop offset="100%" stop-color="#8AB9DC"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1070" cy="110" r="180" fill="#DAEEFE" opacity="0.65"/>
  <circle cx="130" cy="540" r="140" fill="#DAEEFE" opacity="0.5"/>
  <rect x="64" y="64" width="1072" height="502" rx="44" fill="#FFFFFF" stroke="#D5E0E7" stroke-width="2"/>
  <rect x="128" y="155" width="320" height="320" rx="76" fill="url(#badge)"/>
  <svg x="156" y="183" width="264" height="264" viewBox="0 0 200 200">
    ${mascotInner}
  </svg>
  <text x="504" y="256" font-family="Gabarito" font-weight="800" font-size="96" fill="#131E26">Kotori</text>
  <text x="796" y="248" font-family="Murecho" font-weight="500" font-size="34" fill="#34576F">ことり</text>
  <text x="504" y="328" font-family="Gabarito" font-weight="500" font-size="34" fill="#515C64">Sound natural, not like a textbook.</text>
  <g transform="translate(504, 370)">
    <rect x="0" y="0" width="236" height="46" rx="23" fill="#DAEEFE"/>
    <text x="118" y="30" text-anchor="middle" font-family="Gabarito" font-weight="500" font-size="21" fill="#223C4F">Japanese &amp; English</text>
    <rect x="252" y="0" width="166" height="46" rx="23" fill="#DAEEFE"/>
    <text x="335" y="30" text-anchor="middle" font-family="Gabarito" font-weight="500" font-size="21" fill="#223C4F">Usage guide</text>
    <rect x="434" y="0" width="136" height="46" rx="23" fill="#DAEEFE"/>
    <text x="502" y="30" text-anchor="middle" font-family="Gabarito" font-weight="500" font-size="21" fill="#223C4F">Notebook</text>
  </g>
  <text x="504" y="486" font-family="Gabarito" font-weight="500" font-size="24" fill="#666F76">hellokotori.com</text>
</svg>`
}

const { sky } = palette
const appIcon = mascotSvg({ background: sky, padding: 22 })
const webFavicon = mascotSvg({ background: sky, padding: 14, radius: 44 })

// Native app & Expo config assets
renderPng(assetsOut, "icon.png", appIcon, 1024)
renderPng(assetsOut, "adaptive-icon.png", mascotSvg({ padding: 90 }), 1024)
renderPng(assetsOut, "splash-icon.png", mascotSvg({ padding: 10 }), 600)
renderPng(assetsOut, "favicon.png", webFavicon, 96)
renderPng(assetsOut, "mascot-happy.png", mascotSvg({ mood: "happy", background: sky, padding: 20 }), 400)
renderPng(assetsOut, "mascot-celebrate.png", mascotSvg({ mood: "celebrate", background: sky, padding: 20 }), 400)
renderPng(assetsOut, "mascot-front.png", mascotFrontSvg({ background: sky, padding: 20 }), 400)
renderPng(assetsOut, "mascot-thinking.png", mascotSvg({ mood: "thinking", background: sky, padding: 20 }), 400)
renderPng(assetsOut, "mascot-reading.png", mascotSvg({ mood: "reading", background: sky, padding: 20 }), 400)

// Web favicons, PWA icons, and social preview thumbnail
writeSvg(publicOut, "favicon.svg", webFavicon)
const favicon16 = renderPngBuffer(webFavicon, 16)
const favicon32 = renderPngBuffer(webFavicon, 32)
const favicon48 = renderPngBuffer(webFavicon, 48)
writeFileSync(join(publicOut, "favicon-16x16.png"), favicon16)
console.log("wrote favicon-16x16.png (16px)")
writeFileSync(join(publicOut, "favicon-32x32.png"), favicon32)
console.log("wrote favicon-32x32.png (32px)")
writeFileSync(
  join(publicOut, "favicon.ico"),
  encodeIco([
    { size: 16, png: favicon16 },
    { size: 32, png: favicon32 },
    { size: 48, png: favicon48 }
  ])
)
console.log("wrote favicon.ico (16/32/48px)")
renderPng(publicOut, "apple-touch-icon.png", appIcon, 180)
renderPng(publicOut, "icon-192.png", appIcon, 192)
renderPng(publicOut, "icon-512.png", appIcon, 512)
renderPng(publicOut, "icon-maskable-512.png", mascotSvg({ background: sky, padding: 62 }), 512)
renderPng(publicOut, "og-image.png", ogImageSvg(), 1200, true)
