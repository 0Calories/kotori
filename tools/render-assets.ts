/**
 * Renders the mascot into the app's icon, adaptive icon, splash image and favicon.
 * Usage: pnpm assets
 */
import { Resvg } from "@resvg/resvg-js"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { palette } from "../apps/app/src/mascot/geometry.ts"
import { mascotFrontSvg, mascotSvg } from "../apps/app/src/mascot/svg.ts"

const out = join(import.meta.dirname, "..", "apps", "app", "assets")
mkdirSync(out, { recursive: true })

const render = (file: string, svg: string, width: number) => {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng()
  writeFileSync(join(out, file), png)
  console.log(`wrote ${file} (${width}px)`)
}

const { sky } = palette
render("icon.png", mascotSvg({ background: sky, padding: 22 }), 1024)
render("adaptive-icon.png", mascotSvg({ padding: 90 }), 1024)
render("splash-icon.png", mascotSvg({ padding: 10 }), 600)
render("favicon.png", mascotSvg({ background: sky, padding: 16 }), 96)
render("mascot-happy.png", mascotSvg({ mood: "happy", background: sky, padding: 20 }), 400)
render("mascot-celebrate.png", mascotSvg({ mood: "celebrate", background: sky, padding: 20 }), 400)
render("mascot-front.png", mascotFrontSvg({ background: sky, padding: 20 }), 400)
