/**
 * Cleans up local git state left behind by squash-merged PRs and agent worktrees:
 *   1. Prunes stale remote-tracking refs (`git fetch --prune origin`) and stale worktree metadata.
 *   2. Removes secondary worktrees that have a clean working tree and whose branch tip SHA matches
 *      a MERGED PR's `headRefOid` on GitHub (fresh 0-commit worktrees at `origin/main` are kept).
 *   3. Deletes local branches (not checked out in any remaining worktree) whose tip SHA matches a
 *      MERGED PR's `headRefOid` or that are already ancestors of `origin/main`.
 *
 * Dirty worktrees, reused branch names with new unpushed commits, and open PR branches are never touched.
 * Pass `--dry-run` to preview what would be removed.
 */
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const workspaceRoot = resolve(dirname(dirname(fileURLToPath(import.meta.url))))
const dryRun = process.argv.includes("--dry-run")

const capture = (command: string, args: ReadonlyArray<string>, cwd = workspaceRoot): string => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`\`${[command, ...args].join(" ")}\` failed: ${(result.stderr ?? "").trim()}`)
  }
  return (result.stdout ?? "").trim()
}

const run = (command: string, args: ReadonlyArray<string>): void => {
  if (dryRun) {
    console.log(`[dry-run] ${[command, ...args].join(" ")}`)
    return
  }
  const result = spawnSync(command, args, { cwd: workspaceRoot, stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`\`${[command, ...args].join(" ")}\` failed with exit code ${String(result.status)}`)
  }
}

interface Worktree {
  readonly path: string
  readonly branch: string | null
}

interface MergedPrRef {
  readonly headRefName: string
  readonly headRefOid: string
}

const listWorktrees = (): Array<Worktree> => {
  const out = capture("git", ["worktree", "list", "--porcelain"])
  const items: Array<Worktree> = []
  let currentPath: string | null = null
  let currentBranch: string | null = null

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentPath !== null) items.push({ path: currentPath, branch: currentBranch })
      currentPath = line.slice("worktree ".length)
      currentBranch = null
    } else if (line.startsWith("branch refs/heads/")) {
      currentBranch = line.slice("branch refs/heads/".length)
    }
  }
  if (currentPath !== null) items.push({ path: currentPath, branch: currentBranch })
  return items
}

const loadMergedPrOids = (): Map<string, Set<string>> => {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--state", "merged", "--limit", "200", "--json", "headRefName,headRefOid"],
    {
      cwd: workspaceRoot,
      encoding: "utf8"
    }
  )
  if (result.status !== 0) {
    console.warn("Could not query merged PRs via `gh`; falling back to git ancestry only.")
    return new Map()
  }
  const parsed = JSON.parse(result.stdout ?? "[]") as ReadonlyArray<MergedPrRef>
  const byBranch = new Map<string, Set<string>>()
  for (const pr of parsed) {
    let oids = byBranch.get(pr.headRefName)
    if (oids === undefined) {
      oids = new Set<string>()
      byBranch.set(pr.headRefName, oids)
    }
    oids.add(pr.headRefOid)
  }
  return byBranch
}

const revParse = (ref: string): string => capture("git", ["rev-parse", ref])

const isAncestorOfMain = (ref: string): boolean =>
  spawnSync("git", ["merge-base", "--is-ancestor", ref, "origin/main"], { cwd: workspaceRoot }).status === 0

console.log(dryRun ? "▸ Previewing git cleanup (--dry-run)" : "▸ Pruning remote refs and stale worktree metadata")
run("git", ["fetch", "--prune", "origin"])
run("git", ["worktree", "prune"])

const mergedPrOids = loadMergedPrOids()
const matchesMergedPr = (branch: string): boolean =>
  mergedPrOids.get(branch)?.has(revParse(`refs/heads/${branch}`)) === true
const protectedBranches = new Set(["main", "assets"])

for (const wt of listWorktrees()) {
  if (resolve(wt.path) === workspaceRoot || wt.branch === null || protectedBranches.has(wt.branch)) continue
  if (!matchesMergedPr(wt.branch)) continue

  const dirty = capture("git", ["status", "--porcelain"], wt.path)
  if (dirty.length > 0) {
    console.log(`Skipping dirty worktree ${wt.path} (${wt.branch})`)
    continue
  }

  console.log(`Removing merged worktree ${wt.path} (${wt.branch})`)
  try {
    run("git", ["worktree", "remove", wt.path])
  } catch (error) {
    console.warn(`Failed to remove worktree ${wt.path}: ${String(error)}`)
  }
}

const activeWorktreeBranches = new Set(
  listWorktrees()
    .map((wt) => wt.branch)
    .filter((branch): branch is string => branch !== null)
)

const localBranches = capture("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)

for (const branch of localBranches) {
  if (protectedBranches.has(branch) || activeWorktreeBranches.has(branch)) continue
  const branchRef = `refs/heads/${branch}`
  if (matchesMergedPr(branch) || isAncestorOfMain(branchRef)) {
    console.log(`Deleting merged local branch ${branch}`)
    try {
      // Safe to use `-D`: either `rev-parse` matched a merged PR's `headRefOid`, or `merge-base --is-ancestor`
      // verified the branch is already in `origin/main` (`-d` checks `HEAD`/upstream rather than `origin/main`).
      run("git", ["branch", "-D", branch])
    } catch (error) {
      console.warn(`Failed to delete branch ${branch}: ${String(error)}`)
    }
  }
}
