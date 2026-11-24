import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { applyWebMeta } from "../apps/app/src/lib/webMeta.ts"

const distDir = resolve(process.argv[2] ?? "dist")
const indexPath = join(distDir, "index.html")
const built = readFileSync(indexPath, "utf8")

writeFileSync(indexPath, applyWebMeta(built, "en"))

const jaDir = join(distDir, "ja")
mkdirSync(jaDir, { recursive: true })
writeFileSync(join(jaDir, "index.html"), applyWebMeta(built, "ja"))
