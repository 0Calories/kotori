/**
 * Pre-commit check: a staged file written by a person or an agent must stay within
 * 5,000 tokens. Tokens are bytes / 4, so the limit is 20,000 bytes.
 *
 * The hook reads the index (added, copied, modified, renamed), not the working tree.
 * Deletions are ignored. Paths this file does not consider authored are skipped;
 * extend `NON_AUTHORED` when a new lockfile, generator, vendor tree, or asset shows up.
 *
 *   node tools/file-token-limit.ts
 */
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const BYTES_PER_TOKEN = 4
export const TOKEN_LIMIT = 5_000
export const BYTE_LIMIT = TOKEN_LIMIT * BYTES_PER_TOKEN

/**
 * Files that are not authored by agents or humans. The token limit does not apply
 * to them. This is the only list to edit when the ignore rules need to grow:
 * lockfile basenames, directory names, filename globs (`*` matches within a name),
 * asset extensions, and header markers.
 */
export const NON_AUTHORED = {
  /** Matched against the file's basename, at any directory depth. */
  lockfiles: [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "shrinkwrap.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "Cargo.lock",
    "poetry.lock",
    "Pipfile.lock",
    "pdm.lock",
    "uv.lock",
    "go.sum",
    "composer.lock",
    "Gemfile.lock",
    "packages.lock.json",
    "Package.resolved",
    "flake.lock",
    "pubspec.lock",
    "mix.lock",
    "deno.lock"
  ],
  /**
   * Directory names. A file is ignored when any parent directory matches.
   * `generated` and `__generated__` are codegen output; `vendor` / `third_party`
   * are vendored trees; `__snapshots__` holds test snapshots.
   */
  directories: [
    "generated",
    "__generated__",
    "vendor",
    "vendored",
    "third_party",
    "third-party",
    "__snapshots__",
    "node_modules"
  ],
  /** Globs matched against the basename. `*` does not cross `/`. */
  filenameGlobs: ["*.gen.*", "*.min.*", "*.snap", "*.snapshot"],
  /** Binary, image, and font assets. Compared case-insensitively, including the dot. */
  assetExtensions: [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".icns",
    ".bmp",
    ".avif",
    ".heic",
    ".heif",
    ".tif",
    ".tiff",
    ".svg",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".eot",
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".flac",
    ".aac",
    ".mp4",
    ".webm",
    ".mov",
    ".avi",
    ".mkv",
    ".pdf",
    ".zip",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".7z",
    ".wasm",
    ".bin",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".class",
    ".jar"
  ],
  /**
   * Case-insensitive markers in the header (first lines) of a file.
   * A mention later in the body does not exempt it.
   */
  headerMarkers: ["@generated", "DO NOT EDIT"],
  /** Git attribute (from `.gitattributes`) that marks Linguist-generated files. */
  gitAttribute: "linguist-generated"
} as const

/** How many leading bytes count as a file header when looking for generated markers. */
const HEADER_SCAN_BYTES = 2_048
const HEADER_SCAN_LINES = 20
/** Prefix read from an oversized blob: enough for a NUL sniff and the header scan. */
const PREFIX_BYTES = 4_096

const SPLIT_STEPS = [
  "Identify cohesive sections, such as separate classes, components, functions, or test suites.",
  "Move each section into its own new file named after its contents.",
  "Re-export or import it from the original file so existing callers do not break.",
  "Keep the original file under the limit.",
  "Update imports.",
  "Re-stage the changes with git add.",
  "Re-run the commit."
] as const

export interface Violation {
  readonly path: string
  readonly bytes: number
  readonly tokens: number
}

export interface CheckResult {
  readonly ok: boolean
  readonly violations: readonly Violation[]
  readonly message: string
}

/** Token count for a blob. Rounded up so a file even one byte over 20,000 reports as over 5,000. */
export const tokensForBytes = (bytes: number): number => Math.ceil(bytes / BYTES_PER_TOKEN)

const basename = (filePath: string): string => {
  const slash = filePath.lastIndexOf("/")
  return slash === -1 ? filePath : filePath.slice(slash + 1)
}

const globToRegExp = (glob: string): RegExp => {
  let pattern = ""
  for (const char of glob) {
    if (char === "*") pattern += ".*"
    else if (/[\\.+?^${}()|[\]/]/.test(char)) pattern += `\\${char}`
    else pattern += char
  }
  return new RegExp(`^${pattern}$`, "i")
}

const lockfileNames = new Set<string>(NON_AUTHORED.lockfiles)
const directoryNames = new Set<string>(NON_AUTHORED.directories)
const filenamePatterns = NON_AUTHORED.filenameGlobs.map(globToRegExp)
const assetExtensions = new Set<string>(NON_AUTHORED.assetExtensions)

/** Path-based half of the ignore list. Header markers and `linguist-generated` need content and git. */
export const isNonAuthoredPath = (filePath: string): boolean => {
  const normalized = filePath.replaceAll("\\", "/")
  const name = basename(normalized)
  if (lockfileNames.has(name)) return true
  if (filenamePatterns.some((pattern) => pattern.test(name))) return true
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : ""
  if (extension.length > 0 && assetExtensions.has(extension)) return true
  const parents = normalized.split("/").slice(0, -1)
  return parents.some((dir) => directoryNames.has(dir))
}

const formatNumber = (value: number): string => {
  const digits = Math.trunc(Math.abs(value)).toString()
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) groups.push(digits.slice(Math.max(0, end - 3), end))
  return groups.toReversed().join(",")
}

const hintFor = (filePath: string): string | null => {
  const name = basename(filePath).toLowerCase()
  const parents = filePath.split("/").slice(0, -1)
  const isMarkdown = name.endsWith(".md") || name.endsWith(".mdx")
  const isTest =
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) || parents.includes("test") || parents.includes("__tests__")
  if (isTest && !isMarkdown) {
    return "Hint: this is a test file — split it by test suite (one describe or feature per file) and import shared setup from a helper."
  }
  if (isMarkdown) {
    return "Hint: this is a markdown doc — split it by section and link the new documents from this one."
  }
  if (name.endsWith(".tsx") || name.endsWith(".jsx") || parents.includes("components")) {
    return "Hint: this is a component file — move each component into a file named after it, and re-export it from this file so callers do not break."
  }
  return null
}

export const formatReport = (violations: readonly Violation[]): string => {
  const limit = `${formatNumber(TOKEN_LIMIT)} tokens (${formatNumber(BYTE_LIMIT)} bytes)`
  const intro =
    violations.length === 1
      ? `Commit blocked: a staged file exceeds the ${limit} limit (tokens = bytes / ${BYTES_PER_TOKEN}).`
      : `Commit blocked: ${formatNumber(violations.length)} staged files exceed the ${limit} limit (tokens = bytes / ${BYTES_PER_TOKEN}).`
  const files = violations.flatMap((violation) => {
    const lines = [
      `${violation.path} — ${formatNumber(violation.tokens)} tokens (${formatNumber(violation.bytes)} bytes); the limit is ${limit}.`
    ]
    const hint = hintFor(violation.path)
    if (hint !== null) lines.push(`  ${hint}`)
    return lines
  })
  const steps = SPLIT_STEPS.map((step, index) => `${index + 1}. ${step}`)
  return [intro, "", ...files, "", "Split each file:", ...steps].join("\n")
}

interface GitOutput {
  readonly stdout: Buffer
  readonly stderr: string
  readonly status: number | null
}

/** Run git. When `maxStdout` is set, stop once that many bytes have been read. */
const gitCapture = (cwd: string, args: readonly string[], maxStdout?: number): Promise<GitOutput> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, { cwd })
    const chunks: Buffer[] = []
    let stdoutLength = 0
    let stderr = ""
    let settled = false
    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      resolvePromise({ stdout: Buffer.concat(chunks), stderr, status })
    }
    child.stdout.on("data", (chunk: Buffer) => {
      if (maxStdout !== undefined && stdoutLength >= maxStdout) return
      const take = maxStdout === undefined ? chunk : chunk.subarray(0, maxStdout - stdoutLength)
      chunks.push(take)
      stdoutLength += take.length
      if (maxStdout !== undefined && stdoutLength >= maxStdout) child.kill()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on("close", (status) => finish(status))
  })

const gitText = async (cwd: string, args: readonly string[]): Promise<string> => {
  const result = await gitCapture(cwd, args)
  if (result.status !== 0) {
    const detail = result.stderr.trim()
    throw new Error(detail.length > 0 ? detail : `git ${args.join(" ")} failed`)
  }
  return result.stdout.toString("utf8")
}

/** Added, copied, modified, and renamed paths in the index. Deleted paths are left out. */
const stagedPaths = async (cwd: string): Promise<readonly string[]> => {
  const output = await gitText(cwd, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
  return output.split("\0").filter((path) => path.length > 0)
}

/** Byte size of a staged blob, or null when the index entry is not a blob (a submodule). */
const stagedBlobSize = async (cwd: string, filePath: string): Promise<number | null> => {
  const kind = (await gitText(cwd, ["cat-file", "-t", `:${filePath}`])).trim()
  if (kind !== "blob") return null
  const bytes = Number((await gitText(cwd, ["cat-file", "-s", `:${filePath}`])).trim())
  if (!Number.isInteger(bytes) || bytes < 0) throw new Error(`Could not read the staged size of ${filePath}`)
  return bytes
}

const stagedPrefix = async (cwd: string, filePath: string): Promise<Buffer> => {
  const result = await gitCapture(cwd, ["cat-file", "blob", `:${filePath}`], PREFIX_BYTES)
  if (result.stdout.length >= PREFIX_BYTES || result.status === 0) return result.stdout.subarray(0, PREFIX_BYTES)
  const detail = result.stderr.trim()
  throw new Error(detail.length > 0 ? detail : `git cat-file failed for ${filePath}`)
}

const hasGeneratedHeader = (prefix: Buffer): boolean => {
  const text = prefix.subarray(0, HEADER_SCAN_BYTES).toString("utf8")
  const head = text.split(/\r?\n/).slice(0, HEADER_SCAN_LINES).join("\n").toLowerCase()
  return NON_AUTHORED.headerMarkers.some((marker) => head.includes(marker.toLowerCase()))
}

const linguistGenerated = async (cwd: string, paths: readonly string[]): Promise<ReadonlySet<string>> => {
  const generated = new Set<string>()
  if (paths.length === 0) return generated
  const result = await gitCapture(cwd, ["check-attr", "-z", NON_AUTHORED.gitAttribute, "--", ...paths])
  if (result.status !== 0) {
    const detail = result.stderr.trim()
    throw new Error(detail.length > 0 ? detail : "git check-attr failed")
  }
  const parts = result.stdout.toString("utf8").split("\0")
  for (let index = 0; index + 2 < parts.length; index += 3) {
    const path = parts[index]
    const attribute = parts[index + 1]
    const value = parts[index + 2]
    if (path === undefined || attribute === undefined || value === undefined || path.length === 0) continue
    if (attribute === NON_AUTHORED.gitAttribute && (value === "set" || value === "true")) generated.add(path)
  }
  return generated
}

const passing = (): CheckResult => ({ ok: true, violations: [], message: "" })

/** Check the index at `cwd`. Oversized authored blobs become a split report. */
export const checkStaged = async (cwd: string): Promise<CheckResult> => {
  const paths = await stagedPaths(cwd)
  const candidates = paths.filter((path) => !isNonAuthoredPath(path))
  const sizes = await Promise.all(candidates.map(async (path) => ({ path, bytes: await stagedBlobSize(cwd, path) })))
  const oversized = sizes.filter(
    (file): file is { path: string; bytes: number } => file.bytes !== null && tokensForBytes(file.bytes) > TOKEN_LIMIT
  )
  if (oversized.length === 0) return passing()

  const generated = await linguistGenerated(
    cwd,
    oversized.map((file) => file.path)
  )
  const prefixes = await Promise.all(
    oversized.map(async (file) => ({
      file,
      prefix: generated.has(file.path) ? null : await stagedPrefix(cwd, file.path)
    }))
  )
  const violations: Violation[] = []
  for (const { file, prefix } of prefixes) {
    if (prefix === null || prefix.includes(0) || hasGeneratedHeader(prefix)) continue
    violations.push({ path: file.path, bytes: file.bytes, tokens: tokensForBytes(file.bytes) })
  }
  violations.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  if (violations.length === 0) return passing()
  return { ok: false, violations, message: formatReport(violations) }
}

const runCli = async (): Promise<void> => {
  try {
    const result = await checkStaged(process.cwd())
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`)
      process.exitCode = 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`file token limit: ${message}\n`)
    process.exitCode = 1
  }
}

const invokedDirectly = (): boolean => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === pathToFileURL(resolve(entry)).href
}

if (invokedDirectly()) await runCli()
