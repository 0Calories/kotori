/**
 * Previews one of the mascot's clips without running the app: a sheet of
 * frames, and a page that plays the clip on a loop at 60 fps. The clip plays
 * in the mood it belongs to unless another is given.
 * Usage: pnpm motion <clip> [mood], then `open` the files it prints.
 */
import { Resvg } from "@resvg/resvg-js"
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Mood } from "../apps/app/src/mascot/geometry.ts"
import { type ClipName, clips, entrances } from "../apps/app/src/mascot/motion.ts"
import { frameSvg, framesSvg } from "../apps/app/src/mascot/svg.ts"

const [clip, mood] = process.argv.slice(2)
if (clip === undefined || !(clip in clips)) {
  console.error(`usage: pnpm motion <${Object.keys(clips).join(" | ")}> [mood]`)
  process.exit(1)
}

const name = clip as ClipName
const shown =
  (mood as Mood | undefined) ?? (Object.keys(entrances) as Mood[]).find((m) => entrances[m] === name) ?? "curious"
const base = join(tmpdir(), `kotori-${name}-${shown}`)

writeFileSync(`${base}.png`, new Resvg(framesSvg(name, shown)).render().asPng())

const { duration } = clips[name]
const frames = Array.from({ length: Math.floor(duration / (1000 / 60)) + 1 }, (_, i) =>
  frameSvg(name, shown, Math.min((i * 1000) / 60, duration))
)
writeFileSync(
  `${base}.html`,
  `<!doctype html>
<title>Kotori: ${name}</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#94C1E2;font:14px sans-serif">
<div id="bird" style="width:400px;height:400px"></div>
<label><input id="slow" type="checkbox"> Quarter speed</label>
<script>
const frames = ${JSON.stringify(frames)}
const bird = document.getElementById("bird")
const slow = document.getElementById("slow")
const duration = ${duration}, pause = 800
let start = performance.now()
const tick = (now) => {
  const speed = slow.checked ? 0.25 : 1
  // The first frame's timestamp can come just before \`start\`.
  const t = (Math.max(0, now - start) * speed) % (duration + pause)
  bird.innerHTML = frames[Math.min(frames.length - 1, Math.floor((t * 60) / 1000))].replace('width="200" height="200"', 'width="400" height="400"')
  requestAnimationFrame(tick)
}
slow.onchange = () => (start = performance.now())
requestAnimationFrame(tick)
</script>`
)

console.log(`wrote ${base}.png (frames) and ${base}.html (plays the clip)`)
