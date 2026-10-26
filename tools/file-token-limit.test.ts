import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  BYTE_LIMIT,
  NON_AUTHORED,
  TOKEN_LIMIT,
  formatReport,
  isNonAuthoredPath,
  tokensForBytes,
  type Violation
} from "./file-token-limit.ts"

const script = fileURLToPath(new URL("./file-token-limit.ts", import.meta.url))
const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, args: readonly string[]) => {
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

const initRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "kotori-tokens-"))
  roots.push(root)
  git(root, ["init", "-b", "main"])
  git(root, ["config", "user.email", "hook-test@example.com"])
  git(root, ["config", "user.name", "Hook Test"])
  return root
}

const write = (root: string, path: string, contents: string | Buffer) => {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

const bytes = (length: number, fill = "a"): Buffer => Buffer.alloc(length, fill)

const runHook = (cwd: string) => {
  const result = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout }
}

const expectSplitInstructions = (stderr: string) => {
  expect(stderr).toContain(
    "Identify cohesive sections, such as separate classes, components, functions, or test suites."
  )
  expect(stderr).toContain("Move each section into its own new file named after its contents.")
  expect(stderr).toContain("Re-export or import it from the original file so existing callers do not break.")
  expect(stderr).toContain("Keep the original file under the limit.")
  expect(stderr).toContain("Update imports.")
  expect(stderr).toContain("Re-stage the changes with git add.")
  expect(stderr).toContain("Re-run the commit.")
  expect(stderr).toContain("5,000 tokens")
  expect(stderr).toContain("20,000 bytes")
}

describe("token count", () => {
  it("counts 4 bytes as one token and rounds up", () => {
    expect(tokensForBytes(0)).toBe(0)
    expect(tokensForBytes(1)).toBe(1)
    expect(tokensForBytes(4)).toBe(1)
    expect(tokensForBytes(BYTE_LIMIT)).toBe(TOKEN_LIMIT)
    expect(tokensForBytes(BYTE_LIMIT + 1)).toBe(TOKEN_LIMIT + 1)
  })
})

describe("ignore list", () => {
  it("skips every lockfile basename, including nested copies", () => {
    for (const name of NON_AUTHORED.lockfiles) {
      expect(isNonAuthoredPath(name)).toBe(true)
      expect(isNonAuthoredPath(`packages/app/${name}`)).toBe(true)
    }
  })

  it("skips generated, vendored, and snapshot directories", () => {
    for (const dir of NON_AUTHORED.directories) {
      expect(isNonAuthoredPath(`${dir}/output.ts`)).toBe(true)
      expect(isNonAuthoredPath(`packages/app/src/${dir}/output.ts`)).toBe(true)
    }
    expect(isNonAuthoredPath("src/generated.ts")).toBe(false)
    expect(isNonAuthoredPath("src/not-vendor/app.ts")).toBe(false)
  })

  it("skips codegen, minified, and snapshot filenames", () => {
    expect(isNonAuthoredPath("src/parser.gen.ts")).toBe(true)
    expect(isNonAuthoredPath("web/app.min.js")).toBe(true)
    expect(isNonAuthoredPath("src/card.test.ts.snap")).toBe(true)
    expect(isNonAuthoredPath("src/card.snapshot")).toBe(true)
    expect(isNonAuthoredPath("src/generator.ts")).toBe(false)
    expect(isNonAuthoredPath("src/minute.ts")).toBe(false)
  })

  it("skips image, font, and other binary asset extensions", () => {
    expect(isNonAuthoredPath("apps/app/assets/icon.PNG")).toBe(true)
    expect(isNonAuthoredPath("apps/app/assets/fonts/Marks.ttf")).toBe(true)
    expect(isNonAuthoredPath("docs/screenshots/review.jpg")).toBe(true)
    expect(isNonAuthoredPath("docs/notes.txt")).toBe(false)
  })

  it("does not skip authored source", () => {
    expect(isNonAuthoredPath("packages/auth/src/Auth.ts")).toBe(false)
    expect(isNonAuthoredPath("apps/app/app/entry/[id].tsx")).toBe(false)
    expect(isNonAuthoredPath("apps/app/src/i18n/strings.ts")).toBe(false)
  })
})

describe("split report", () => {
  const violation = (path: string, size: number): Violation => ({
    path,
    bytes: size,
    tokens: tokensForBytes(size)
  })

  it("names each file with its token count and the limit, then the split steps", () => {
    const message = formatReport([violation("src/Big.ts", BYTE_LIMIT + 1), violation("docs/guide.md", BYTE_LIMIT + 80)])
    expect(message).toContain("src/Big.ts — 5,001 tokens (20,001 bytes); the limit is 5,000 tokens (20,000 bytes).")
    expect(message).toContain("docs/guide.md")
    expect(message).toContain("Hint: this is a markdown doc — split it by section")
    expectSplitInstructions(message)
  })

  it("hints for tests and components", () => {
    const tests = formatReport([violation("packages/srs/test/scheduler.test.ts", BYTE_LIMIT + 1)])
    expect(tests).toContain("Hint: this is a test file — split it by test suite")
    const component = formatReport([violation("apps/app/src/components/Card.tsx", BYTE_LIMIT + 1)])
    expect(component).toContain("Hint: this is a component file — move each component into a file named after it")
  })
})

describe("pre-commit hook", () => {
  it("passes a staged file sitting on the limit", () => {
    const root = initRepo()
    write(root, "src/note.ts", bytes(BYTE_LIMIT))
    git(root, ["add", "-A"])
    const result = runHook(root)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
  })

  it("fails an oversized staged file and prints how to split it", () => {
    const root = initRepo()
    write(root, "src/Big.ts", bytes(BYTE_LIMIT + 1))
    git(root, ["add", "-A"])
    const result = runHook(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("src/Big.ts — 5,001 tokens (20,001 bytes)")
    expect(result.stderr).toContain("the limit is 5,000 tokens (20,000 bytes)")
    expectSplitInstructions(result.stderr)
  })

  it("skips ignored files that are over the limit", () => {
    const root = initRepo()
    const oversized = bytes(BYTE_LIMIT + 200)
    const files = [
      "pnpm-lock.yaml",
      "packages/app/generated/api.ts",
      "packages/app/__generated__/types.ts",
      "vendor/leftpad.js",
      "third_party/lib.c",
      "third-party/lib.c",
      "src/__snapshots__/card.snap",
      "src/parser.gen.ts",
      "web/app.min.js",
      "assets/icon.png",
      "assets/font.ttf"
    ]
    for (const path of files) write(root, path, oversized)
    write(root, "payload.dat", Buffer.concat([Buffer.from([0]), oversized]))
    write(root, "codegen/output.ts", `// @generated by the schema tool\n${"x".repeat(BYTE_LIMIT + 10)}`)
    write(root, "codegen/frozen.ts", `/* DO NOT EDIT. Generated from the schema. */\n${"y".repeat(BYTE_LIMIT + 10)}`)
    write(root, ".gitattributes", "marked.ts linguist-generated\nstar.ts linguist-generated=true\n")
    write(root, "marked.ts", oversized)
    write(root, "star.ts", oversized)
    git(root, ["add", "-A"])
    const result = runHook(root)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
  })

  it("does not treat a marker past the header, or linguist-generated=false, as an exemption", () => {
    const root = initRepo()
    // The markers sit past the first 20 lines but still inside the bytes the hook reads,
    // then the file is padded past the limit. Only a real header exempts a file.
    const lines = Array.from({ length: 30 }, (_unused, index) => `const value${index} = 1`)
    lines.push("DO NOT EDIT")
    lines.push("@generated")
    write(root, "src/late.ts", `${lines.join("\n")}\n${"z".repeat(BYTE_LIMIT)}`)
    write(root, ".gitattributes", "src/kept.ts linguist-generated=false\n")
    write(root, "src/kept.ts", bytes(BYTE_LIMIT + 20))
    git(root, ["add", "-A"])
    const result = runHook(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("src/late.ts")
    expect(result.stderr).toContain("src/kept.ts")
    expectSplitInstructions(result.stderr)
  })

  it("checks only staged content, not the working tree or deletions", () => {
    const root = initRepo()
    write(root, "src/note.ts", bytes(100))
    write(root, "src/unstaged.ts", bytes(BYTE_LIMIT + 500))
    git(root, ["add", "src/note.ts"])
    write(root, "src/note.ts", bytes(BYTE_LIMIT + 500))
    const unstagedGrowth = runHook(root)
    expect(unstagedGrowth.status).toBe(0)

    git(root, ["add", "-A"])
    write(root, "src/note.ts", "export const note = 1\n")
    write(root, "src/unstaged.ts", "export const fine = 1\n")
    const stagedGrowth = runHook(root)
    expect(stagedGrowth.status).not.toBe(0)
    expect(stagedGrowth.stderr).toContain("src/note.ts")
    expect(stagedGrowth.stderr).toContain("src/unstaged.ts")
    expect(stagedGrowth.stderr).not.toContain("src/other.ts")

    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "oversized"])
    git(root, ["rm", "-r", "src"])
    const deleted = runHook(root)
    expect(deleted.status).toBe(0)
    expect(deleted.stderr).toBe("")
  })

  it("checks a renamed file's new staged path and a bracketed path", () => {
    const root = initRepo()
    write(root, "src/old.ts", bytes(BYTE_LIMIT + 30))
    git(root, ["add", "-A"])
    git(root, ["commit", "-m", "add"])
    git(root, ["mv", "src/old.ts", "src/renamed.ts"])
    write(root, "app/entry/[id].tsx", bytes(BYTE_LIMIT + 40))
    git(root, ["add", "-A"])
    const result = runHook(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("src/renamed.ts")
    expect(result.stderr).not.toContain("src/old.ts")
    expect(result.stderr).toContain("app/entry/[id].tsx")
    expect(result.stderr).toContain("Hint: this is a component file")
  })

  it("uses the staged header, not a header that exists only in the working tree", () => {
    const root = initRepo()
    write(root, "src/built.ts", `// @generated\n${"q".repeat(BYTE_LIMIT + 10)}`)
    git(root, ["add", "-A"])
    write(root, "src/built.ts", "q".repeat(BYTE_LIMIT + 10))
    const stagedMarker = runHook(root)
    expect(stagedMarker.status).toBe(0)

    git(root, ["add", "-A"])
    write(root, "src/built.ts", `// DO NOT EDIT\n${"q".repeat(BYTE_LIMIT + 10)}`)
    const worktreeMarker = runHook(root)
    expect(worktreeMarker.status).not.toBe(0)
    expect(worktreeMarker.stderr).toContain("src/built.ts")
  })

  it("the shell hook is executable and runs this script", () => {
    const hook = join(repoRoot, ".githooks", "pre-commit")
    const text = readFileSync(hook, "utf8")
    expect(text).toContain("tools/file-token-limit.ts")
    expect(statSync(hook).mode & 0o111).not.toBe(0)
  })
})
