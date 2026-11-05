import { describe, expect, it } from "vitest"
import { kotori } from "../../src/cli/kotori.ts"
import {
  type CommandSpec,
  commandLine,
  commandName,
  commandSpecs,
  initialValues,
  problemWith,
  toArgv
} from "../../src/console/model/commands.ts"
import { COVERED_BY_VIEW, jobEffects, jobGroups } from "../../src/console/model/jobs.ts"

const specs = commandSpecs(kotori)
const spec = (name: string): CommandSpec => {
  const found = specs.find((each) => commandName(each) === name)
  if (found === undefined) throw new Error(`no command ${name}`)
  return found
}

describe("reading the CLI's commands", () => {
  it("finds every command that runs, under its full path", () => {
    expect(specs.map(commandName)).toEqual([
      "migrate",
      "proposals list",
      "proposals show",
      "proposals approve",
      "proposals discard",
      "proposals redo",
      "seed",
      "enrich",
      "familiarity",
      "eval",
      "golden",
      "status",
      "storage lists",
      "storage audio",
      "storage compact",
      "requests",
      "approve",
      "archive",
      "users",
      "admin",
      "revoke",
      "dev-account"
    ])
  })

  it("reads each parameter's kind, type, choices, default and description", () => {
    const fields = Object.fromEntries(spec("enrich").fields.map((field) => [field.name, field]))
    expect(fields["kind"]).toMatchObject({
      kind: "argument",
      type: "choice",
      choices: ["nuance", "examples", "audio"],
      required: true,
      initial: undefined
    })
    expect(fields["entry"]).toMatchObject({ kind: "flag", type: "integer", required: false, initial: undefined })
    expect(fields["limit"]).toMatchObject({ type: "integer", required: false, initial: 100 })
    expect(fields["common-only"]).toMatchObject({ type: "boolean", initial: true })
    expect(fields["dictionary"]).toMatchObject({ type: "choice", initial: "all" })
    expect(fields["limit"]?.description).toBe("How many entries to process")
  })

  it("gives the console a view or a job for every command, so nothing the CLI does is out of reach", () => {
    const jobs = new Set(jobGroups(specs).flatMap((group) => group.jobs.map(commandName)))
    for (const each of specs) {
      const name = commandName(each)
      expect(COVERED_BY_VIEW[name] !== undefined || jobs.has(name), name).toBe(true)
    }
    for (const name of Object.keys(COVERED_BY_VIEW)) expect(specs.map(commandName)).toContain(name)
  })

  it("groups the jobs, with a command it doesn't know under Other", () => {
    const groups = jobGroups(specs)
    expect(groups.map((group) => group.name)).toEqual(["Dictionary", "Enrichment", "Evals", "Database", "Accounts"])
    const extra = { path: ["reindex"], description: "", fields: [] }
    expect(jobGroups([...specs, extra]).at(-1)).toEqual({ name: "Other", jobs: [extra] })
  })
})

describe("filling in a command", () => {
  it("starts from the CLI's defaults and writes only what was changed", () => {
    const enrich = spec("enrich")
    const values = { ...initialValues(enrich), kind: "nuance" }
    expect(toArgv(enrich, values)).toEqual(["enrich", "nuance"])
    // A number left as typed text still matches its default.
    expect(toArgv(enrich, { ...values, limit: "100" })).toEqual(["enrich", "nuance"])
    expect(toArgv(enrich, { ...values, limit: "500", dictionary: "jmdict", "common-only": false })).toEqual([
      "enrich",
      "nuance",
      "--dictionary",
      "jmdict",
      "--limit",
      "500",
      "--common-only",
      "false"
    ])
    expect(toArgv(spec("storage compact"), { "cap-mb": 1024, "reserve-mb": 64, "dry-run": true })).toEqual([
      "storage",
      "compact",
      "--dry-run"
    ])
  })

  it("says what's missing or malformed before running", () => {
    const enrich = spec("enrich")
    expect(problemWith(enrich, initialValues(enrich))).toBe("pick a kind with ← → on its row")
    expect(problemWith(enrich, { ...initialValues(enrich), kind: "nuance", limit: "lots" })).toBe(
      "limit must be a whole number"
    )
    expect(problemWith(enrich, { ...initialValues(enrich), kind: "nuance" })).toBeUndefined()
  })

  it("shows a command as it can be pasted into a shell", () => {
    expect(commandLine(["proposals", "discard", "12", "--reason", "it's a typo"])).toBe(
      `kotori proposals discard 12 --reason 'it'\\''s a typo'`
    )
  })
})

describe("what a job does", () => {
  it("asks first when a job writes or costs, and not for dry runs or reading", () => {
    expect(jobEffects(spec("storage compact"), { "dry-run": true })).toEqual([])
    expect(jobEffects(spec("storage compact"), { "dry-run": false })[0]?.database).toBe(true)
    expect(jobEffects(spec("familiarity"), { "dry-run": true })).toEqual([])
    expect(jobEffects(spec("eval"), { kind: "nuance", from: "answers.json" })).toEqual([])
    expect(jobEffects(spec("enrich"), { kind: "audio", limit: 50 }).map((effect) => effect.text)).toEqual([
      "Calls ElevenLabs for up to 50 entries, which costs inference",
      "Saves the audio it gets"
    ])
  })
})
