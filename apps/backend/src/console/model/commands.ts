import { Effect, Option } from "effect"
import { type Command, Primitive } from "effect/cli"

/**
 * The CLI's commands as data, so the console builds a form for every one of them from the
 * definitions `kotori` itself parses, and runs it with the same argv. A flag added to the CLI
 * appears in the console with its description and default, with no console change.
 *
 * effect/cli doesn't publish a command's parameters, so this reads the parsed config it keeps on
 * each command. `effect` is pinned exactly; `test/console/commands.test.ts` walks the real CLI, so
 * a release that moves these internals fails there first.
 */

type FieldType = "text" | "integer" | "number" | "boolean" | "choice"
export type FieldValue = string | number | boolean | undefined

export interface Field {
  /** The flag's name without `--`, or the positional argument's name. */
  readonly name: string
  readonly kind: "argument" | "flag"
  readonly type: FieldType
  readonly choices: ReadonlyArray<string>
  readonly description: string | undefined
  /** What the CLI uses when the field is left out: its default, or undefined for an optional one. */
  readonly initial: FieldValue
  /** Leaving it out is a usage error. */
  readonly required: boolean
}

export interface CommandSpec {
  /** The words after `kotori`: `["storage", "compact"]`. */
  readonly path: ReadonlyArray<string>
  readonly description: string
  readonly fields: ReadonlyArray<Field>
}

export type Values = Readonly<Record<string, FieldValue>>

/** The shape of effect/cli's parameters, as far as the console reads them. */
interface SingleParam {
  readonly _tag: "Single"
  readonly kind: "argument" | "flag"
  readonly name: string
  readonly description: Option.Option<string>
  /** A Choice primitive also keeps its choices, which effect/cli reads but doesn't type. */
  readonly primitiveType: Primitive.Primitive<unknown> & { readonly choiceKeys?: ReadonlyArray<string> }
}
interface WrappedParam {
  readonly _tag: "Map" | "Transform" | "Optional" | "Variadic"
  readonly kind: "argument" | "flag"
  readonly param: AnyParam
}
type AnyParam = (SingleParam | WrappedParam) & {
  readonly parse: (args: {
    readonly flags: Readonly<Record<string, ReadonlyArray<string>>>
    readonly arguments: ReadonlyArray<string>
  }) => Effect.Effect<readonly [unknown, unknown], unknown>
}

const isParam = (value: unknown): value is AnyParam =>
  typeof value === "object" && value !== null && "_tag" in value && "kind" in value && "parse" in value

/** A command's parameters in declaration order; throws if effect/cli no longer keeps them where expected. */
const paramsOf = (command: Command.Command.Any): ReadonlyArray<AnyParam> => {
  const config: unknown = (command as unknown as { readonly config?: unknown }).config
  const ordered =
    typeof config === "object" && config !== null && "orderedParams" in config ? config.orderedParams : undefined
  if (!Array.isArray(ordered) || !ordered.every(isParam)) {
    throw new Error(`effect/cli no longer exposes the parameters of \`${command.name}\`; see console/model/commands.ts`)
  }
  return ordered
}

const fieldType = (primitive: Primitive.Primitive<unknown>): FieldType => {
  switch (Primitive.getTypeName(primitive)) {
    case "boolean":
      return "boolean"
    case "integer":
      return "integer"
    case "number":
      return "number"
    case "choice":
      return "choice"
    default:
      return "text"
  }
}

/** What the parameter parses to with nothing given: its default, none for an optional one, or a usage error. */
const parseEmpty = (param: AnyParam): { readonly required: boolean; readonly value: FieldValue } => {
  const result = Effect.runSyncExit(param.parse({ flags: {}, arguments: [] }))
  if (result._tag === "Failure") return { required: true, value: undefined }
  const value = result.value[1]
  if (Option.isOption(value)) return { required: false, value: Option.getOrUndefined(value) as FieldValue }
  return {
    required: false,
    value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined
  }
}

const toField = (param: AnyParam): Field => {
  let single: AnyParam = param
  while (single._tag !== "Single") single = single.param
  const leaf = single
  const empty = parseEmpty(param)
  return {
    name: leaf.name,
    kind: leaf.kind,
    type: fieldType(leaf.primitiveType),
    choices: leaf.primitiveType.choiceKeys ?? [],
    description: Option.getOrUndefined(leaf.description),
    initial: empty.value,
    required: empty.required
  }
}

/** Every command that runs (rather than only grouping others) under `root`, depth first in the CLI's order. */
export const commandSpecs = (root: Command.Command.Any): ReadonlyArray<CommandSpec> => {
  const specs: Array<CommandSpec> = []
  const visit = (command: Command.Command.Any, path: ReadonlyArray<string>) => {
    const children = command.subcommands.flatMap((group) => group.commands)
    if (children.length === 0) {
      specs.push({ path, description: command.description ?? "", fields: paramsOf(command).map(toField) })
      return
    }
    for (const child of children) visit(child, [...path, child.name])
  }
  visit(root, [])
  return specs
}

export const commandName = (spec: Pick<CommandSpec, "path">) => spec.path.join(" ")

/** The form's starting values: each field's default. */
export const initialValues = (spec: CommandSpec): Values =>
  Object.fromEntries(spec.fields.map((field) => [field.name, field.initial]))

/** A value as the command line takes it: typed text without the spaces around it. */
const clean = (value: FieldValue) => (typeof value === "string" ? value.trim() : value)

/** Empty text means "not given" for an optional field. */
const given = (value: FieldValue) => {
  const cleaned = clean(value)
  return cleaned !== undefined && cleaned !== ""
}

/** Why the form can't run yet, or undefined when it can. */
export const problemWith = (spec: CommandSpec, values: Values): string | undefined => {
  for (const field of spec.fields) {
    const value = clean(values[field.name])
    if (field.required && !given(value)) {
      return field.type === "choice" ? `pick a ${field.name} with ← → on its row` : `${field.name} is required`
    }
    if (!given(value)) continue
    if (field.type === "integer" && !/^-?\d+$/u.test(String(value))) return `${field.name} must be a whole number`
    if (field.type === "number" && !Number.isFinite(Number(value))) return `${field.name} must be a number`
    if (field.type === "choice" && !field.choices.includes(String(value))) {
      return `${field.name} must be one of ${field.choices.join(", ")}`
    }
  }
  return undefined
}

/**
 * The argv after `kotori` that runs the form as filled in: positional arguments in order, then every
 * flag whose value differs from the CLI's default, so it reads as a person would type it.
 */
export const toArgv = (spec: CommandSpec, values: Values): ReadonlyArray<string> => {
  const argv: Array<string> = [...spec.path]
  for (const field of spec.fields) {
    if (field.kind !== "argument") continue
    const value = clean(values[field.name])
    if (given(value)) argv.push(String(value))
  }
  for (const field of spec.fields) {
    if (field.kind !== "flag") continue
    const value = clean(values[field.name])
    // Form fields hold what was typed, so a number left at its default arrives as text.
    if (!given(value) || String(value) === String(field.initial)) continue
    if (field.type === "boolean") argv.push(...(value === true ? [`--${field.name}`] : [`--${field.name}`, "false"]))
    else argv.push(`--${field.name}`, String(value))
  }
  return argv
}

/** Quotes an argument for a shell when it needs it, so a shown command can be pasted as is. */
const shellQuote = (arg: string) => (/^[\w@%+=:,./-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)

/** The command line the form runs, as `pnpm kotori …` would take it. */
export const commandLine = (argv: ReadonlyArray<string>) => ["kotori", ...argv.map(shellQuote)].join(" ")
