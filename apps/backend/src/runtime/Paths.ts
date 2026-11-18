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

const workspaceRoot = findRoot(process.cwd())

export const resolveFromRoot = (path: string) => (isAbsolute(path) ? path : resolve(workspaceRoot, path))

const nxLoadedDotEnv = (env: NodeJS.ProcessEnv) =>
  env["NX_TASK_TARGET_PROJECT"] !== undefined && env["NX_LOAD_DOT_ENV_FILES"] !== "false"

export const loadDotEnv = (root: string = workspaceRoot, env: NodeJS.ProcessEnv = process.env) => {
  const merged: Record<string, string> = {}
  for (const name of [".env", ".env.local"]) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    // Skip named pipes (such as 1Password Environment mounts, which block concurrent readers) when Nx has already loaded dotenv.
    if (nxLoadedDotEnv(env) && statSync(file).isFIFO()) continue
    Object.assign(merged, parseEnv(readFileSync(file, "utf8")))
  }
  for (const [key, value] of Object.entries(merged)) {
    if (env[key] === undefined) env[key] = value
  }
}
