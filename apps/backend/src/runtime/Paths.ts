import { existsSync, readFileSync, statSync } from "node:fs"
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
const workspaceRoot = findRoot(process.cwd())

export const resolveFromRoot = (path: string) => (isAbsolute(path) ? path : resolve(workspaceRoot, path))

const nxLoadedDotEnv = (env: NodeJS.ProcessEnv) =>
  env["NX_TASK_TARGET_PROJECT"] !== undefined && env["NX_LOAD_DOT_ENV_FILES"] !== "false"

/**
 * Loads the repo's `.env`, then `.env.local` (which the Neon CLI writes and which
 * overrides `.env`), into `process.env`. Variables already set in the environment win.
 *
 * When `.env` is a named pipe (such as a 1Password Environment mount, which does not
 * support concurrent readers) and Nx has already loaded dotenv into `process.env`,
 * re-opening the pipe is skipped so parallel `pnpm dev` tasks don't race or hang on it.
 */
export const loadDotEnv = (root: string = workspaceRoot, env: NodeJS.ProcessEnv = process.env) => {
  const merged: Record<string, string> = {}
  for (const name of [".env", ".env.local"]) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    if (nxLoadedDotEnv(env) && statSync(file).isFIFO()) continue
    Object.assign(merged, parseEnv(readFileSync(file, "utf8")))
  }
  for (const [key, value] of Object.entries(merged)) {
    if (env[key] === undefined) env[key] = value
  }
}
