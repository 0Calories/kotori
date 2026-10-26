/**
 * Points this clone at `.githooks` so the token-limit pre-commit hook runs.
 * `pnpm install` runs this via the `prepare` script. Skipped outside a git checkout.
 */
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, stdio: "ignore" })
} catch {
  process.exit(0)
}

execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: root })
