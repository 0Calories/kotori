import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import { commandLine } from "../model/commands.ts"
import { ago, duration, width as columns } from "../model/format.ts"
import type { LineLevel, Task, TaskLine } from "../model/tasks.ts"
import { type Column, Hints, Panel, Spinner, Table, useNow, useTick } from "../ui/components.tsx"
import { useConsole, useRuns, useViewSize } from "../ui/context.tsx"
import { Layer, moveIn, useKeys } from "../ui/keys.tsx"
import { useOverlay } from "../ui/overlay.tsx"
import { color, statusLook, symbol } from "../ui/theme.ts"

const lineColor: Readonly<Record<LineLevel, string>> = {
  out: color.text,
  error: color.danger,
  warn: color.warn,
  info: color.muted,
  debug: color.faint
}

/** Splits lines wider than the log into rows, so scrolling counts what's on screen. */
const wrap = (lines: ReadonlyArray<TaskLine>, room: number): ReadonlyArray<TaskLine> =>
  lines.flatMap((line) => {
    if (columns(line.text) <= room) return [line]
    const rows: Array<TaskLine> = []
    let row = ""
    let used = 0
    for (const char of line.text) {
      const w = columns(char)
      if (used + w > room) {
        rows.push({ level: line.level, text: row })
        row = ""
        used = 0
      }
      row += char
      used += w
    }
    if (row.length > 0) rows.push({ level: line.level, text: row })
    return rows
  })

/** A run's log, showing the rows that fit; it follows new output until scrolled up. */
const Log = ({
  run,
  height,
  width,
  top
}: {
  readonly run: Task
  readonly height: number
  readonly width: number
  /** The first row shown, or undefined to follow the end. */
  readonly top: number | undefined
}) => {
  const rows = wrap(run.lines, width)
  const start = top === undefined ? Math.max(0, rows.length - height) : Math.min(top, Math.max(0, rows.length - height))
  return (
    <box flexDirection="column" height={height} flexShrink={0}>
      {run.dropped > 0 && start === 0 ? (
        <text fg={color.faint}>{`… ${run.dropped} earlier lines let go to keep the log short`}</text>
      ) : null}
      {rows.length === 0 ? (
        <text fg={color.faint}>{run.status === "running" ? "Nothing printed yet." : "It printed nothing."}</text>
      ) : (
        rows
          .slice(start, start + height)
          .map((row, index) => ({ row, at: start + index }))
          .map(({ row, at }) => (
            <text key={at} fg={lineColor[row.level]}>
              {row.text.length === 0 ? " " : row.text}
            </text>
          ))
      )}
    </box>
  )
}

/** Every job run this session, newest first, with its full output. */
export const Runs = () => {
  const { runtime, focusedRun } = useConsole()
  const overlay = useOverlay()
  const size = useViewSize()
  const runs = useRuns()
  // The run is chosen by id, so new runs arriving at the top don't move it; the jobs view opens one.
  const [chosen, setChosen] = useState<number | undefined>(focusedRun)
  const [top, setTop] = useState<number | undefined>(undefined)
  const running = runs.some((run) => run.status === "running")
  const now = useNow(1000)
  const frame = useTick(120, running)

  const found = runs.findIndex((run) => run.id === chosen)
  const at = found >= 0 ? found : 0
  const run = runs[at]
  const listHeight = Math.min(8, Math.max(3, runs.length + 1))
  const logHeight = Math.max(4, size.height - listHeight - 9)
  const logWidth = size.width - 4
  const rowCount = run === undefined ? 0 : wrap(run.lines, logWidth).length
  const scrollBy = (delta: number) =>
    setTop((now) => {
      const from = now ?? Math.max(0, rowCount - logHeight)
      const next = Math.max(0, Math.min(rowCount - logHeight, from + delta))
      return next >= rowCount - logHeight ? undefined : next
    })

  useKeys(
    (key) => {
      const moved = moveIn(key, at, runs.length, 5)
      if (moved !== undefined) {
        setChosen(runs[moved]?.id)
        setTop(undefined)
        return true
      }
      switch (key.name) {
        case "J":
        case "shift+down":
          scrollBy(3)
          return true
        case "K":
        case "shift+up":
          scrollBy(-3)
          return true
        case "space":
          scrollBy(logHeight - 2)
          return true
        case "b":
          scrollBy(-(logHeight - 2))
          return true
        case "F":
        case "end":
          setTop(undefined)
          return true
        case "c":
          if (run?.status !== "running") return true
          void overlay
            .confirm({
              title: "Stop run",
              lines: [
                `Stop ${commandLine(run.argv)}?`,
                "It's interrupted where it is: work already saved stays, and a transaction in flight rolls back."
              ],
              action: "Stop",
              danger: true
            })
            .then((ok) => {
              if (ok) runtime.cancelJob(run.id)
            })
          return true
        case "x":
          runtime.tasks.clearFinished()
          setChosen(undefined)
          return true
        default:
          return false
      }
    },
    { layer: Layer.view }
  )

  const columnsOfList: ReadonlyArray<Column<Task>> = [
    {
      header: "",
      width: 2,
      cell: (row) =>
        row.status === "running" ? symbol.spinner[frame % symbol.spinner.length]! : statusLook[row.status].icon,
      fg: (row) => statusLook[row.status].color
    },
    { header: "Command", width: "fill", cell: (row) => commandLine(row.argv) },
    { header: "Started", width: 8, align: "right", cell: (row) => ago(new Date(row.startedAt), now) },
    { header: "Took", width: 8, align: "right", cell: (row) => duration((row.endedAt ?? now) - row.startedAt) },
    { header: "Lines", width: 6, align: "right", cell: (row) => String(row.lines.length + row.dropped) }
  ]

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <Panel title="Runs this session" grow={false}>
        <Table
          columns={columnsOfList}
          rows={runs}
          selected={at}
          height={listHeight}
          width={size.width - 4}
          rowKey={(row) => String(row.id)}
          onSelect={(next) => {
            setChosen(runs[next]?.id)
            setTop(undefined)
          }}
          empty="Nothing has run yet. Start a job from Jobs (4)."
        />
      </Panel>
      <Panel title={run === undefined ? "Output" : commandLine(run.argv)}>
        {run === undefined ? (
          <text fg={color.faint}>A run's output shows here.</text>
        ) : (
          <box flexDirection="column">
            <Log run={run} height={logHeight} width={logWidth} top={top} />
            <text>
              {run.status === "running" ? (
                <Spinner />
              ) : (
                <span fg={statusLook[run.status].color}>{statusLook[run.status].icon}</span>
              )}
              <span
                fg={statusLook[run.status].color}
                attributes={TextAttributes.BOLD}
              >{` ${statusLook[run.status].label}`}</span>
              {run.failure === undefined ? null : <span fg={color.danger}>{`  ${run.failure.split("\n")[0]}`}</span>}
              <span fg={color.faint}>
                {top === undefined ? "  following" : `  row ${top + 1} of ${rowCount}  (F to follow)`}
              </span>
            </text>
          </box>
        )}
      </Panel>
      <Hints
        hints={[
          { key: "↑↓", label: "run" },
          { key: "J/K space b", label: "scroll" },
          { key: "F", label: "follow" },
          ...(run?.status === "running" ? [{ key: "c", label: "stop…" }] : []),
          { key: "x", label: "clear finished" }
        ]}
        width={size.width}
      />
    </box>
  )
}
