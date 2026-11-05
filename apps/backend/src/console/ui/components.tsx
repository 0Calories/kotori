import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { type ReactNode, type RefObject, useEffect, useState } from "react"
import { fit, meter, width as columnsOf } from "../model/format.ts"
import { color, symbol } from "./theme.ts"

/** Re-renders every `ms` while `active`, for spinners and elapsed times. */
export const useTick = (ms: number, active = true) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((value) => value + 1), ms)
    return () => clearInterval(id)
  }, [ms, active])
  return tick
}

/** The time, kept current every `ms`, for "3m ago" and elapsed times; reading the clock in render isn't pure. */
export const useNow = (ms: number) => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** A spinner frame, as a span for use inside `<text>`. */
export const Spinner = ({ fg = color.info }: { readonly fg?: string }) => {
  const tick = useTick(80)
  return <span fg={fg}>{symbol.spinner[tick % symbol.spinner.length]}</span>
}

/** A quiet scrollbar: a thumb in the border's colour on the background. */
const SCROLLBAR = { trackOptions: { foregroundColor: color.borderStrong, backgroundColor: color.background } }

/** A region that scrolls when its content outgrows it, by the view's keys (`scroll`) or the mouse wheel. */
export const Scroll = ({
  children,
  scroll,
  minHeight = 0
}: {
  readonly children?: ReactNode
  readonly scroll?: RefObject<ScrollBoxRenderable | null>
  readonly minHeight?: number
}) => (
  <scrollbox
    {...(scroll === undefined ? {} : { ref: scroll })}
    flexGrow={1}
    flexShrink={1}
    minHeight={minHeight}
    scrollY
    verticalScrollbarOptions={SCROLLBAR}
  >
    {children}
  </scrollbox>
)

/** A bordered box with a title, its border lit while it has the keys. */
export const Panel = ({
  title,
  focused = false,
  children,
  grow = true,
  width,
  height,
  padded = true
}: {
  readonly title?: string | undefined
  readonly focused?: boolean
  readonly children?: ReactNode
  readonly grow?: boolean
  readonly width?: number | `${number}%` | undefined
  readonly height?: number | `${number}%` | undefined
  readonly padded?: boolean
}) => (
  <box
    border
    borderStyle="rounded"
    borderColor={focused ? color.primary : color.border}
    {...(title === undefined ? {} : { title: ` ${title} `, titleColor: focused ? color.primary : color.muted })}
    flexDirection="column"
    flexGrow={grow ? 1 : 0}
    // A panel sized by its content keeps it; squeezed, its rows would draw over each other.
    flexShrink={grow ? 1 : 0}
    {...(width === undefined ? {} : { width })}
    {...(height === undefined ? {} : { height })}
    paddingLeft={padded ? 1 : 0}
    paddingRight={padded ? 1 : 0}
  >
    {children}
  </box>
)

export interface Tab {
  readonly label: string
  readonly count?: number | undefined
}

const tabLabel = (tab: Tab) => ` ${tab.label}${tab.count === undefined ? "" : ` ${tab.count}`} `

/** The tabs that fit in `room` columns around the chosen one, widening right, then left. */
const tabWindow = (tabs: ReadonlyArray<Tab>, selected: number, room: number) => {
  const widths = tabs.map((tab) => columnsOf(tabLabel(tab)))
  if (widths.reduce((sum, w) => sum + w, 0) <= room) return { start: 0, end: tabs.length }
  // Room for the arrows that say there are more.
  const inner = room - 4
  let start = selected
  let end = selected + 1
  let used = widths[selected] ?? 0
  for (let grew = true; grew;) {
    grew = false
    if (end < tabs.length && used + widths[end]! <= inner) {
      used += widths[end++]!
      grew = true
    }
    if (start > 0 && used + widths[start - 1]! <= inner) {
      used += widths[--start]!
      grew = true
    }
  }
  return { start, end }
}

/**
 * A row of filters; the chosen one sits on a green tab. ← and → move between them (the view's
 * keys). When they don't all fit, the row scrolls to keep the chosen one in sight.
 */
export const Tabs = ({
  tabs,
  selected,
  width = Infinity
}: {
  readonly tabs: ReadonlyArray<Tab>
  readonly selected: number
  readonly width?: number
}) => {
  const { start, end } = tabWindow(tabs, selected, width)
  return (
    <text flexShrink={0}>
      {start > 0 ? <span fg={color.faint}>‹ </span> : null}
      {tabs.slice(start, end).map((tab, index) =>
        start + index === selected ? (
          <span key={tab.label} bg={color.primarySoft} fg={color.text} attributes={TextAttributes.BOLD}>
            {tabLabel(tab)}
          </span>
        ) : (
          <span key={tab.label} fg={color.muted}>
            {tabLabel(tab)}
          </span>
        )
      )}
      {end < tabs.length ? <span fg={color.faint}> ›</span> : null}
    </text>
  )
}

export interface Column<T> {
  readonly header: string
  /** Columns wide; one column may take what's left. */
  readonly width: number | "fill"
  readonly align?: "left" | "right"
  readonly cell: (row: T) => string
  readonly fg?: (row: T) => string | undefined
  /** Left out when the table is too narrow, the highest first; columns without one always show. */
  readonly drop?: number
}

const GAP = 2
/** The least a fill column is given before other columns are dropped for it. */
const MIN_FILL = 14

/** The columns that fit in `room`, dropping the optional ones in order, with `fill` resolved. */
const fitColumns = <T,>(columns: ReadonlyArray<Column<T>>, room: number) => {
  let kept = [...columns]
  const needs = (set: ReadonlyArray<Column<T>>) =>
    set.reduce((sum, column) => sum + (column.width === "fill" ? MIN_FILL : column.width), 0) +
    GAP * Math.max(0, set.length - 1)
  while (needs(kept) > room) {
    const droppable = kept.filter((column) => column.drop !== undefined)
    if (droppable.length === 0) break
    const next = droppable.reduce((a, b) => (b.drop! > a.drop! ? b : a))
    kept = kept.filter((column) => column !== next)
  }
  const fixed = kept.reduce((sum, column) => sum + (column.width === "fill" ? 0 : column.width), 0)
  const gaps = GAP * Math.max(0, kept.length - 1)
  return kept.map((column) => ({
    column,
    width: column.width === "fill" ? Math.max(8, room - fixed - gaps) : column.width
  }))
}

/**
 * A list with a header and a highlighted row, showing only the rows that fit. Once the list is
 * longer than the room, the selected row stays in the middle as it moves. The view moves the
 * selection; the table just draws it.
 */
export const Table = <T,>({
  columns,
  rows,
  selected,
  height,
  width,
  rowKey,
  onSelect,
  focused = true,
  empty = "Nothing here."
}: {
  readonly columns: ReadonlyArray<Column<T>>
  readonly rows: ReadonlyArray<T>
  readonly selected: number
  /** Rows of the terminal the table may use, header included. */
  readonly height: number
  readonly width: number
  readonly rowKey: (row: T) => string
  /** A click on a row, by its index in `rows`. */
  readonly onSelect?: (index: number) => void
  readonly focused?: boolean
  readonly empty?: string
}) => {
  const shownColumns = fitColumns(columns, width)
  const scrolls = rows.length > height - 1
  const visible = Math.max(1, height - 1 - (scrolls ? 1 : 0))
  const offset = Math.max(0, Math.min(selected - Math.floor(visible / 2), rows.length - visible))
  const shown = rows.slice(offset, offset + visible)
  const line = (cells: ReadonlyArray<string>) => cells.join(" ".repeat(GAP))

  return (
    <box flexDirection="column" height={height} flexShrink={0}>
      <text fg={color.faint}>
        {line(shownColumns.map(({ column, width: w }) => fit(column.header, w, column.align)))}
      </text>
      {rows.length === 0 ? (
        <text fg={color.muted}>{empty}</text>
      ) : (
        shown.map((row, index) => {
          const isSelected = offset + index === selected
          return (
            <box
              key={rowKey(row)}
              height={1}
              flexShrink={0}
              {...(isSelected ? { backgroundColor: focused ? color.selected : color.raised } : {})}
              {...(onSelect === undefined ? {} : { onMouseDown: () => onSelect(offset + index) })}
            >
              <text>
                {shownColumns.map(({ column, width: w }, at) => (
                  <span
                    key={column.header}
                    fg={column.fg?.(row) ?? (isSelected ? color.text : color.muted)}
                    {...(isSelected && at === 0 ? { attributes: TextAttributes.BOLD } : {})}
                  >
                    {fit(column.cell(row), w, column.align) + (at < shownColumns.length - 1 ? "  " : "")}
                  </span>
                ))}
              </text>
            </box>
          )
        })
      )}
      {scrolls ? <text fg={color.faint}>{`${offset + 1}–${offset + shown.length} of ${rows.length}`}</text> : null}
    </box>
  )
}

/** A meter for `part` of `whole`, as spans for use inside `<text>`. */
export const Meter = ({
  part,
  whole,
  cells,
  fg = color.primary
}: {
  readonly part: number
  readonly whole: number
  readonly cells: number
  readonly fg?: string
}) => {
  const { filled, empty } = meter(part, whole, cells)
  return (
    <>
      <span fg={fg}>{filled}</span>
      <span fg={color.border}>{empty}</span>
    </>
  )
}

export interface Hint {
  readonly key: string
  readonly label: string
}

/** Key hints: the key in green, what it does after it; as many as fit in `width`, in order. */
export const Hints = ({
  hints,
  width = Infinity
}: {
  readonly hints: ReadonlyArray<Hint>
  readonly width?: number
}) => {
  const widths = hints.map((hint) => columnsOf(hint.key) + columnsOf(hint.label) + 4)
  const fitting = widths.findIndex((_, index) => widths.slice(0, index + 1).reduce((sum, w) => sum + w, 0) > width)
  return <HintLine hints={fitting === -1 ? hints : hints.slice(0, fitting)} />
}

const HintLine = ({ hints }: { readonly hints: ReadonlyArray<Hint> }) => (
  <text flexShrink={0}>
    {hints.map((hint) => (
      <span key={`${hint.key}${hint.label}`}>
        <span fg={color.primary} attributes={TextAttributes.BOLD}>
          {hint.key}
        </span>
        <span fg={color.muted}>{` ${hint.label}   `}</span>
      </span>
    ))}
  </text>
)

/** A "label   value" line with the label in a fixed-width muted column. */
export const Row = ({
  label,
  children,
  labelWidth = 12
}: {
  readonly label: string
  readonly children?: ReactNode
  readonly labelWidth?: number
}) => (
  <box flexDirection="row" flexShrink={0}>
    <box width={labelWidth} flexShrink={0}>
      <text fg={color.faint}>{label}</text>
    </box>
    <box flexGrow={1} flexShrink={1}>
      {children}
    </box>
  </box>
)

/** A one-line message for a view that's loading, empty or failed. */
export const Status = ({
  state,
  children
}: {
  readonly state: "loading" | "empty" | "error"
  readonly children: ReactNode
}) =>
  state === "loading" ? (
    <text fg={color.muted}>
      <Spinner /> {children}
    </text>
  ) : (
    <text fg={state === "error" ? color.danger : color.muted}>{children}</text>
  )
