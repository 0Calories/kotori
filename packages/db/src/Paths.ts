import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { parseEnv } from "node:util"

const findRoot = (start: string): string => {
  let dir = start
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

/** The monorepo root, so every app resolves `data/` and `.env` to the same place. */
export const workspaceRoot = findRoot(process.cwd())

export const resolveFromRoot = (path: string) => (isAbsolute(path) ? path : resolve(workspaceRoot, path))

/**
 * Loads the repo's `.env`, then `.env.local` (which the Neon CLI writes and which
 * overrides `.env`), into `process.env`. Variables already set in the environment win.
 */
export const loadDotEnv = () => {
  const merged: Record<string, string> = {}
  for (const name of [".env", ".env.local"]) {
    const file = join(workspaceRoot, name)
    if (existsSync(file)) Object.assign(merged, parseEnv(readFileSync(file, "utf8")))
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
