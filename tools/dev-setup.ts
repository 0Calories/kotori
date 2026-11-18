/**
 * One-time local setup, safe to re-run: `.env` from `.env.example`, Postgres in Docker,
 * the schema (`kotori migrate`), the dictionaries (JMDict, and the English one for Japanese
 * speakers), and the development account the app signs in as. Each step skips what is already
 * done. Run with `pnpm dev:setup`.
 *
 * It only touches a database and auth server on this machine: when `DATABASE_URL` or
 * `NEON_AUTH_BASE_URL` points elsewhere, it stops before contacting either, unless run as
 * `pnpm dev:setup --remote` to set up a remote development database (a Neon branch of your own).
 *
 * It never deletes data. A Docker volume from an older Postgres, or a database still on the
 * schema from before the Drizzle rebuild, stops it with the command to start over instead.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { isLocalHost, remoteDatabaseHost } from "./local-auth/src/localHost.ts"

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** `.env.local` (the Neon CLI's), then `.env`: the first file to set a variable wins, and the environment beats both. */
const loadDotEnv = () => {
  for (const name of [".env.local", ".env"]) {
    const file = join(workspaceRoot, name)
    if (existsSync(file)) process.loadEnvFile(file)
  }
}

const step = (title: string) => console.log(`\n▸ ${title}`)

function fail(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

const run = (command: string, args: ReadonlyArray<string>, failure?: string) => {
  const result = spawnSync(command, args, { cwd: workspaceRoot, stdio: "inherit" })
  if (result.status !== 0) fail(failure ?? `\`${[command, ...args].join(" ")}\` failed.`)
}

/** How the 18+ Postgres images refuse a volume laid out by an older major (or mounted at `…/data`). */
const OLD_VOLUME = "in 18+, these Docker images are configured to store database data"

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
const remoteDatabase = remoteDatabaseHost(
  process.env["DATABASE_URL"] ?? "postgres://kotori:kotori@localhost:5432/kotori"
)
const authUrl = process.env["NEON_AUTH_BASE_URL"]?.replace(/\/$/, "")
if (authUrl === undefined) {
  fail("NEON_AUTH_BASE_URL is not set. Copy the line from .env.example into your .env.")
}
const localAuthUrl = isLocalHost(new URL(authUrl).hostname)
const remote = [
  ...(remoteDatabase === undefined ? [] : [`DATABASE_URL points at ${remoteDatabase}`]),
  ...(localAuthUrl ? [] : [`NEON_AUTH_BASE_URL points at ${new URL(authUrl).host}`])
]
if (remote.length > 0) {
  if (!process.argv.includes("--remote")) {
    fail(`${remote.join(", and ")}, not this machine, so nothing was set up.
  This script migrates the database, imports the dictionaries and creates the development account,
  so it only sets up the local ones unless told otherwise. Either:

    - point both at the local ones (the lines in .env.example) and run it again, or
    - if that is a development setup of your own (a Neon branch, say), run \`pnpm dev:setup --remote\``)
  }
  if (remoteDatabase !== undefined && localAuthUrl) {
    // tools/local-auth refuses a remote database, so the development account couldn't be made.
    fail(`DATABASE_URL points at ${remoteDatabase} but NEON_AUTH_BASE_URL at this machine, so nothing was set up.
  The local auth server only runs against a local database. Point NEON_AUTH_BASE_URL at that
  database's own auth (its Neon branch's) and run this again.`)
  }
  console.log(`${remote.join(", and ")}; setting it up as asked (--remote).`)
}

step("Postgres")
if (remoteDatabase === undefined) {
  const up = spawnSync("docker", ["compose", "up", "--detach", "--wait"], { cwd: workspaceRoot, stdio: "inherit" })
  if (up.status !== 0) {
    const logs = spawnSync("docker", ["compose", "logs", "--no-color", "--no-log-prefix", "postgres"], {
      cwd: workspaceRoot,
      encoding: "utf8"
    })
    if (`${logs.stdout ?? ""}${logs.stderr ?? ""}`.includes(OLD_VOLUME)) {
      fail(`Postgres 18 can't start on your existing Docker volume, which an older Postgres created.
  The local database isn't upgraded: it starts over on the new schema. Delete it and run this again:

    docker compose down -v   # deletes the local database, including the dev account, notes and reviews
    pnpm dev:setup`)
    }
    fail("`docker compose up` failed. Is Docker running? The Postgres log is in `docker compose logs postgres`.")
  }
} else {
  console.log(`DATABASE_URL points at ${remoteDatabase}; not starting the local one.`)
}

step("Schema")
run("pnpm", ["--silent", "kotori", "migrate"], "The schema couldn't be applied; see above.")

step("Dictionaries")
run("pnpm", ["--silent", "kotori", "seed", "--if-empty"])

step("Development account")
// `dev-account` signs up through the auth server, so the local one has to be running.
let localAuth: ChildProcess | undefined
process.on("exit", () => localAuth?.kill("SIGTERM"))
if (localAuthUrl && !(await reachable(`${authUrl}/ok`))) {
  localAuth = spawn(
    process.execPath,
    ["--conditions=@kotori/source", "--import", "tsx", "tools/local-auth/src/main.ts"],
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
