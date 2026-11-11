import { type CommandSpec, commandName, type Values } from "./commands.ts"

/** The views that cover CLI commands with more than a form: lists to act on rather than flags to fill. */
export type View = "overview" | "accounts" | "proposals"

/** CLI commands the console answers with a view of their own; every other command is a job. */
export const COVERED_BY_VIEW: Readonly<Record<string, View>> = {
  status: "overview",
  requests: "accounts",
  approve: "accounts",
  archive: "accounts",
  users: "accounts",
  admin: "accounts",
  revoke: "accounts",
  "proposals list": "proposals",
  "proposals show": "proposals",
  "proposals approve": "proposals",
  "proposals discard": "proposals",
  "proposals redo": "proposals"
}

/** How the jobs list is grouped. A command not listed here still appears, under "Other". */
const GROUPS: ReadonlyArray<{ readonly name: string; readonly commands: ReadonlyArray<string> }> = [
  { name: "Dictionary", commands: ["seed", "familiarity", "golden"] },
  { name: "Enrichment", commands: ["enrich"] },
  { name: "Evals", commands: ["eval"] },
  { name: "Database", commands: ["migrate", "storage lists", "storage audio", "storage compact"] },
  { name: "Accounts", commands: ["dev-account"] }
]

export interface JobGroup {
  readonly name: string
  readonly jobs: ReadonlyArray<CommandSpec>
}

/** The CLI's commands that run as jobs, grouped, in the order the jobs list shows them. */
export const jobGroups = (specs: ReadonlyArray<CommandSpec>): ReadonlyArray<JobGroup> => {
  const jobs = specs.filter((spec) => COVERED_BY_VIEW[commandName(spec)] === undefined)
  const byName = new Map(jobs.map((spec) => [commandName(spec), spec]))
  const groups: Array<JobGroup> = GROUPS.map((group) => ({
    name: group.name,
    jobs: group.commands.flatMap((name) => {
      const spec = byName.get(name)
      return spec === undefined ? [] : [spec]
    })
  })).filter((group) => group.jobs.length > 0)
  const grouped = new Set(GROUPS.flatMap((group) => group.commands))
  const other = jobs.filter((spec) => !grouped.has(commandName(spec)))
  return other.length === 0 ? groups : [...groups, { name: "Other", jobs: other }]
}

/** Something a job does beyond reading, for its confirmation. */
export interface Consequence {
  readonly text: string
  /** It writes to the database the console points at, so a live target is called out. */
  readonly database: boolean
}

const count = (value: Values[string], noun: string) => `up to ${String(value)} ${noun}`

/**
 * What running the job as filled in would change or cost. Empty means it only reads, so it runs
 * without asking; a command the console doesn't know is assumed to need a look.
 */
export const jobEffects = (spec: CommandSpec, values: Values): ReadonlyArray<Consequence> => {
  const name = commandName(spec)
  switch (name) {
    case "migrate":
      return [{ text: "Applies pending migrations to the schema", database: true }]
    case "seed":
      return [
        ...(values["file"] === undefined || values["file"] === ""
          ? [{ text: "Downloads the latest dictionary sources into data/", database: false }]
          : []),
        { text: "Imports them into the dictionary, updating entries in place", database: true }
      ]
    case "enrich": {
      if (values["reinterpret"] === true) {
        return [{ text: "Re-derives stored nuance from saved answers (no inference)", database: true }]
      }
      const entries =
        values["entry"] === undefined || values["entry"] === "" ? count(values["limit"], "entries") : "1 entry"
      const provider = values["kind"] === "examples" ? "Claude" : values["kind"] === "audio" ? "ElevenLabs" : "Jev"
      return [
        { text: `Calls ${provider} for ${entries}, which costs inference`, database: false },
        { text: `Saves the ${String(values["kind"] ?? "enrichment")} it gets`, database: true }
      ]
    }
    case "familiarity":
      return values["dry-run"] === true
        ? []
        : [
            { text: `Calls Claude to rate ${count(values["limit"], "phrases")}`, database: false },
            { text: "Rewrites data/eiwa/familiarity.json", database: false }
          ]
    case "eval":
      return [
        ...(values["from"] === undefined || values["from"] === ""
          ? [{ text: "Calls Jev for the whole golden set, which costs inference", database: false }]
          : []),
        ...(values["record"] === undefined || values["record"] === ""
          ? []
          : [{ text: `Writes the answers to ${String(values["record"])}`, database: false }])
      ]
    case "golden":
      return [{ text: "Rewrites the golden fixture from data/", database: false }]
    case "storage lists":
      return [{ text: "Rewrites senses and forms rows in vacuumed batches", database: true }]
    case "storage audio":
      return [
        { text: "Uploads every clip to the bucket and deletes its row, then truncates audio_files", database: true }
      ]
    case "storage compact":
      return values["dry-run"] === true
        ? []
        : [{ text: "Runs VACUUM FULL on each dictionary table, locking it while it runs", database: true }]
    case "dev-account":
      return [
        {
          text: `Gives ${String(values["email"] ?? "the account")} a known password in the identity store`,
          database: true
        }
      ]
    default:
      return [{ text: `Runs kotori ${name}`, database: true }]
  }
}

/** Jobs that read or write the database at all, so the target is worth showing beside them. */
export const touchesDatabase = (spec: CommandSpec) => !["eval", "golden"].includes(commandName(spec))
