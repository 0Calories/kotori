/**
 * One-time local setup, safe to re-run: `.env` from `.env.example`, Postgres in Docker,
 * the JMDict dictionary, and the development account the app signs in as. Each step
 * skips what is already done. Run with `pnpm dev:setup`.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadDotEnv, workspaceRoot } from "../packages/db/src/Paths.ts"

const LOCAL = new Set(["localhost", "127.0.0.1"])

const step = (title: string) => console.log(`\n▸ ${title}`)

function fail(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = spawnSync(command, args, { cwd: workspaceRoot, stdio: "inherit" })
  if (result.status !== 0) fail(`\`${[command, ...args].join(" ")}\` failed.`)
}

const reachable = async (url: string) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok
  } catch {
    return false
  }
}

step("Environment")
const envFile = join(workspaceRoot, ".env")
if (existsSync(envFile)) {
  console.log("Keeping the existing .env.")
} else {
  copyFileSync(join(workspaceRoot, ".env.example"), envFile)
  console.log("Created .env from .env.example. Add API keys there to turn on the AI features.")
}
loadDotEnv()
const databaseUrl = new URL(process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori")
const authUrl = process.env["NEON_AUTH_BASE_URL"]?.replace(/\/$/, "")
if (authUrl === undefined) {
  fail("NEON_AUTH_BASE_URL is not set. Copy the line from .env.example into your .env.")
}

step("Postgres")
if (LOCAL.has(databaseUrl.hostname)) {
  run("docker", ["compose", "up", "--detach", "--wait"])
} else {
  console.log(`DATABASE_URL points at ${databaseUrl.hostname}; not starting the local one.`)
}

step("Dictionary")
run("pnpm", ["--silent", "kotori", "seed", "--if-empty"])

step("Development account")
// `dev-account` signs up through the auth server, so the local one has to be running.
let localAuth: ChildProcess | undefined
process.on("exit", () => localAuth?.kill("SIGTERM"))
if (LOCAL.has(new URL(authUrl).hostname) && !(await reachable(`${authUrl}/ok`))) {
  localAuth = spawn(
    process.execPath,
    ["--conditions=@kotori/source", "--import", "tsx", "apps/local-auth/src/main.ts"],
    { cwd: workspaceRoot, stdio: "inherit" }
  )
  const server = localAuth
  const deadline = Date.now() + 30_000
  const started = async (): Promise<void> => {
    if (await reachable(`${authUrl}/ok`)) return
    if (server.exitCode !== null || Date.now() > deadline) fail("The local auth server didn't start.")
    await new Promise((resolve) => setTimeout(resolve, 250))
    return started()
  }
  await started()
}
run("pnpm", ["--silent", "kotori", "dev-account"])
localAuth?.kill("SIGTERM")

console.log(`
✓ Ready. Start everything with:

  pnpm dev       # auth stand-in, API on :4000 and the enrichment worker
  pnpm dev:app   # in a second terminal; press w for web, i for iOS, a for Android
`)
