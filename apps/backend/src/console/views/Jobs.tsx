import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import {
  type CommandSpec,
  commandLine,
  commandName,
  type Field,
  type FieldValue,
  initialValues,
  problemWith,
  toArgv,
  type Values
} from "../model/commands.ts"
import { duration, fit, plural, since, truncate } from "../model/format.ts"
import { jobEffects, jobGroups, touchesDatabase } from "../model/jobs.ts"
import type { Task } from "../model/tasks.ts"
import { Hints, Panel, Scroll, Spinner, useNow } from "../ui/components.tsx"
import { useConsole, useRuns, useViewSize } from "../ui/context.tsx"
import { Layer, moveIn, useKeys } from "../ui/keys.tsx"
import { TargetLine, useOverlay } from "../ui/overlay.tsx"
import { color, statusLook, symbol } from "../ui/theme.ts"

const LABEL = 15
const CONTROL = 26

/** The newest run of this job, if it has had one this session. */
const lastRunOf = (runs: ReadonlyArray<Task>, spec: CommandSpec) =>
  runs.find((run) => spec.path.every((word, index) => run.argv[index] === word))

/** A field typed into rather than picked from. */
const isText = (field: Field) => field.type === "text" || field.type === "integer" || field.type === "number"

/** A choice's options; an optional flag without a default can also be left out, shown as —. */
const optionsOf = (field: Field) =>
  field.required || field.initial !== undefined ? field.choices : ["", ...field.choices]

const cycle = (field: Field, value: FieldValue, step: 1 | -1): FieldValue => {
  if (field.type === "boolean") return value !== true
  const choices = optionsOf(field)
  const at = choices.indexOf(value === undefined ? "" : String(value))
  return choices[(at + step + choices.length) % choices.length] || undefined
}

const Control = ({
  field,
  value,
  active,
  width,
  onInput
}: {
  readonly field: Field
  readonly value: FieldValue
  readonly active: boolean
  readonly width: number
  readonly onInput: (value: string) => void
}) => {
  if (field.type === "boolean") {
    return (
      <text fg={active ? color.text : color.muted}>
        <span fg={value === true ? color.primary : color.faint}>{value === true ? "[x]" : "[ ]"}</span>
        {value === true ? " yes" : " no"}
      </text>
    )
  }
  if (field.type === "choice") {
    return (
      <text>
        {optionsOf(field).map((choice) =>
          choice === (value === undefined ? "" : String(value)) ? (
            <span
              key={choice}
              bg={active ? color.primarySoft : color.raised}
              fg={color.text}
            >{` ${choice || "—"} `}</span>
          ) : (
            <span key={choice} fg={color.faint}>{` ${choice || "—"} `}</span>
          )
        )}
      </text>
    )
  }
  return active ? (
    <input
      focused
      width={width - 2}
      value={value === undefined ? "" : String(value)}
      placeholder={field.required ? "required" : "optional"}
      onInput={onInput}
      backgroundColor={color.raised}
      focusedBackgroundColor={color.raised}
      textColor={color.text}
      focusedTextColor={color.text}
      placeholderColor={color.faint}
    />
  ) : (
    <text fg={value === undefined || value === "" ? color.faint : color.text}>
      {value === undefined || value === "" ? (field.required ? "required" : "—") : String(value)}
    </text>
  )
}

const LastRun = ({ run }: { readonly run: Task | undefined }) => {
  const now = useNow(1000)
  if (run === undefined) return <text fg={color.faint}>Not run yet this session.</text>
  const look = statusLook[run.status]
  const last = run.lines.findLast((line) => line.text.trim().length > 0)
  const took = (run.endedAt ?? now) - run.startedAt
  return (
    <box flexDirection="column">
      <text>
        {run.status === "running" ? <Spinner /> : <span fg={look.color}>{look.icon}</span>}
        <span fg={look.color}>{` ${look.label}`}</span>
        <span
          fg={color.muted}
        >{`  ${symbol.dot}  started ${since(new Date(run.startedAt), now)}  ${symbol.dot}  ${duration(took)}  ${symbol.dot}  ${plural(run.lines.length + run.dropped, "line")}`}</span>
      </text>
      {last === undefined ? null : (
        <text fg={run.status === "failed" ? color.danger : color.text}>{truncate(run.failure ?? last.text, 200)}</text>
      )}
    </box>
  )
}

/** Every CLI command without a view of its own, as a form built from its flags. */
export const Jobs = () => {
  const { runtime, specs, target, showRun } = useConsole()
  const overlay = useOverlay()
  const size = useViewSize()
  const runs = useRuns()
  const groups = jobGroups(specs)
  const jobs = groups.flatMap((group) => group.jobs)
  const [index, setIndex] = useState(0)
  const [focus, setFocus] = useState<"list" | "form">("list")
  const [fieldIndex, setFieldIndex] = useState(0)
  const [edits, setEdits] = useState<Readonly<Record<string, Values>>>({})

  const spec = jobs[Math.min(index, jobs.length - 1)]
  const name = spec === undefined ? "" : commandName(spec)
  const values: Values = spec === undefined ? {} : (edits[name] ?? initialValues(spec))
  const fields = spec?.fields ?? []
  const field = fields[Math.min(fieldIndex, Math.max(0, fields.length - 1))]
  const problem = spec === undefined ? undefined : problemWith(spec, values)
  const argv = spec === undefined ? [] : toArgv(spec, values)
  const effects = spec === undefined ? [] : jobEffects(spec, values)
  const lastRun = spec === undefined ? undefined : lastRunOf(runs, spec)

  const setValue = (fieldName: string, value: FieldValue) =>
    setEdits((all) => ({ ...all, [name]: { ...values, [fieldName]: value } }))

  const run = async () => {
    if (spec === undefined) return
    if (problem !== undefined) return overlay.toast("warn", `Can't run yet: ${problem}.`)
    if (effects.length > 0) {
      const ok = await overlay.confirm({
        title: `Run ${name}`,
        lines: [commandLine(argv), "", ...effects.map((effect) => `${symbol.pointer} ${effect.text}`)],
        action: "Run",
        writes: effects.some((effect) => effect.database)
      })
      if (!ok) return
    }
    runtime.runJob(argv)
    overlay.toast("info", `Started ${commandLine(argv)}. Its output is under Last run, and in Runs.`)
  }

  useKeys(
    (key) => {
      const moved = moveIn(key, index, jobs.length)
      if (moved !== undefined) {
        setIndex(moved)
        setFieldIndex(0)
        return true
      }
      switch (key.name) {
        case "return":
        case "right":
        case "l":
        case "tab":
          if (fields.length > 0) setFocus("form")
          else void run()
          return true
        case "o":
          if (lastRun !== undefined) showRun(lastRun.id)
          return true
        case "R":
          setEdits((all) => {
            const { [name]: _, ...rest } = all
            return rest
          })
          return true
        default:
          return false
      }
    },
    { layer: Layer.view, active: focus === "list" }
  )

  useKeys(
    (key) => {
      if (field === undefined) return false
      const text = isText(field)
      switch (key.name) {
        case "escape":
          setFocus("list")
          return true
        case "up":
        case "shift+tab":
          setFieldIndex((value) => (value + fields.length - 1) % fields.length)
          return true
        case "down":
        case "tab":
          setFieldIndex((value) => (value + 1) % fields.length)
          return true
        case "return":
          void run()
          return true
        case "left":
        case "right":
          if (text) return false
          setValue(field.name, cycle(field, values[field.name], key.name === "left" ? -1 : 1))
          return true
        case "space":
          if (text) return false
          setValue(field.name, cycle(field, values[field.name], 1))
          return true
        default:
          return false
      }
    },
    // Typing goes to a text field, so it holds every key; on a choice or a toggle the console's keys still work.
    { layer: Layer.panel, active: focus === "form", modal: field !== undefined && isText(field) }
  )

  // Side by side when there's room; otherwise the list and the form take turns, ⏎ and esc between them.
  const wide = size.width >= 100
  const listWidth = wide ? 26 : size.width
  const formWidth = wide ? size.width - listWidth - 1 : size.width
  const control = Math.min(CONTROL, Math.max(14, formWidth - LABEL - 6))
  const descriptionWidth = formWidth - LABEL - control - 7
  const inline = descriptionWidth >= 24

  const list = (
    <Panel title="Jobs" grow={!wide} width={wide ? listWidth : undefined} focused={focus === "list"}>
      <Scroll>
        {groups.map((group) => (
          <box key={group.name} flexDirection="column" flexShrink={0}>
            <text fg={color.faint} attributes={TextAttributes.BOLD} flexShrink={0}>
              {group.name.toUpperCase()}
            </text>
            {group.jobs.map((job) => {
              const selected = job === spec
              const jobRun = lastRunOf(runs, job)
              return (
                <box
                  key={commandName(job)}
                  height={1}
                  flexShrink={0}
                  onMouseDown={() => {
                    setIndex(jobs.indexOf(job))
                    setFieldIndex(0)
                    setFocus("list")
                  }}
                  {...(selected ? { backgroundColor: color.selected } : {})}
                >
                  <text>
                    <span fg={selected ? color.text : color.muted}>{fit(`  ${commandName(job)}`, listWidth - 8)}</span>
                    {jobRun?.status === "running" ? (
                      <Spinner />
                    ) : jobRun === undefined ? null : (
                      <span fg={statusLook[jobRun.status].color}>{statusLook[jobRun.status].icon}</span>
                    )}
                  </text>
                </box>
              )
            })}
          </box>
        ))}
      </Scroll>
    </Panel>
  )

  const form =
    spec === undefined ? (
      <Panel title="Job">
        <text fg={color.muted}>No jobs.</text>
      </Panel>
    ) : (
      <Panel title={`kotori ${name}`} focused={focus === "form"}>
        <Scroll>
          <box flexDirection="column" gap={1} flexShrink={0}>
            <text fg={color.text}>{spec.description}</text>
            <box flexDirection="column" flexShrink={0}>
              {fields.length === 0 ? <text fg={color.muted}>No options: it runs as is.</text> : null}
              {fields.map((each) => {
                const active = focus === "form" && field === each
                return (
                  <box
                    key={each.name}
                    flexDirection="row"
                    height={1}
                    flexShrink={0}
                    {...(active ? { backgroundColor: color.raised } : {})}
                  >
                    <box width={LABEL} flexShrink={0}>
                      <text fg={active ? color.primary : color.muted}>
                        {fit(`${active ? symbol.pointer : " "} ${each.name}${each.required ? "*" : ""}`, LABEL - 1)}
                      </text>
                    </box>
                    <box width={control} flexShrink={0}>
                      <Control
                        field={each}
                        value={values[each.name]}
                        active={active}
                        width={control}
                        onInput={(value) => setValue(each.name, value)}
                      />
                    </box>
                    {inline ? (
                      <box flexGrow={1} flexShrink={1}>
                        <text fg={color.faint}>{truncate(each.description ?? "", descriptionWidth)}</text>
                      </box>
                    ) : null}
                  </box>
                )
              })}
            </box>
            {field?.description !== undefined && (!inline || field.description.length > descriptionWidth) ? (
              <text fg={color.muted}>{`${field.name}: ${field.description}`}</text>
            ) : null}
            <box flexDirection="column" flexShrink={0}>
              <text>
                <span fg={color.faint}>$ </span>
                <span fg={problem === undefined ? color.text : color.faint}>{commandLine(argv)}</span>
              </text>
              {problem === undefined ? null : <text fg={color.warn}>{`${symbol.warning} ${problem}`}</text>}
              {effects.map((effect) => (
                <text key={effect.text} fg={color.muted}>{`${symbol.pointer} ${effect.text}`}</text>
              ))}
              {effects.length === 0 ? <text fg={color.faint}>Only reads, so it runs without asking.</text> : null}
            </box>
            {touchesDatabase(spec) ? <TargetLine target={target} /> : null}
            <box flexDirection="column" flexShrink={0}>
              <text fg={color.faint} attributes={TextAttributes.BOLD}>
                LAST RUN
              </text>
              <LastRun run={lastRun} />
            </box>
          </box>
        </Scroll>
      </Panel>
    )

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} gap={1}>
        {wide || focus === "list" ? list : null}
        {wide || focus === "form" ? form : null}
      </box>
      <Hints
        hints={
          focus === "list"
            ? [
                { key: "⏎", label: "fill in" },
                { key: "↑↓", label: "pick a job" },
                ...(lastRun === undefined ? [] : [{ key: "o", label: "open last run" }]),
                ...(edits[name] === undefined ? [] : [{ key: "R", label: "reset form" }])
              ]
            : [
                { key: "⏎", label: "run" },
                { key: "↑↓ tab", label: "field" },
                { key: "←→ space", label: "change" },
                { key: "esc", label: "back to jobs" }
              ]
        }
        width={size.width}
      />
    </box>
  )
}
