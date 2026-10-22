import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

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

/** Loads the repo's `.env` into `process.env`. Variables already set in the environment win. */
export const loadDotEnv = () => {
  const file = join(workspaceRoot, ".env")
  if (existsSync(file)) process.loadEnvFile(file)
}
