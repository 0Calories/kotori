#!/usr/bin/env node
// The admin console: `pnpm kotori` with no command. It renders with OpenTUI, which needs Node 26.4 or
// later with --experimental-ffi; the backend's `console` script starts it that way. Everything else,
// the CLI included, stays on the repository's Node.
import { loadDotEnv } from "../runtime/Paths.ts"

loadDotEnv()

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write("The Kotori console needs a terminal. For scripts, run a command: pnpm kotori --help\n")
  process.exit(1)
}

// Loaded after the environment, so modules that read it on import see `.env` too.
const { runConsole } = await import("../console/main.tsx")
await runConsole()
// A driver's idle socket mustn't hold the terminal once the console has closed.
process.exit(0)
