/** A job's run in the console: a `kotori` command with the lines it printed and how it ended. */
export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled"

export type LineLevel = "out" | "error" | "warn" | "info" | "debug"

export interface TaskLine {
  readonly level: LineLevel
  readonly text: string
}

export interface Task {
  readonly id: number
  readonly argv: ReadonlyArray<string>
  readonly status: TaskStatus
  readonly startedAt: number
  readonly endedAt: number | undefined
  readonly lines: ReadonlyArray<TaskLine>
  /** How many early lines were let go to keep a long run's log bounded. */
  readonly dropped: number
  /** Why it failed, when it did. */
  readonly failure: string | undefined
}

/** The most lines kept per run; a backfill logs one per entry. */
export const MAX_LINES = 5000

// oxlint-disable-next-line no-control-regex -- terminal escapes are what it strips
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu

/** Text as a log shows it: one entry per line, without terminal colour codes or trailing blanks. */
export const toLines = (text: string): ReadonlyArray<string> =>
  text
    .replaceAll(ANSI, "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))

interface Draft {
  id: number
  argv: ReadonlyArray<string>
  status: TaskStatus
  startedAt: number
  endedAt: number | undefined
  lines: Array<TaskLine>
  dropped: number
  failure: string | undefined
}

/**
 * The runs of this session, newest first, as an external store for React. Lines arrive faster than
 * the screen redraws, so changes are batched: listeners hear at most once per `schedule` tick.
 */
export class TaskStore {
  private readonly drafts: Array<Draft> = []
  /** The last published copy of each run, rebuilt only once it changes. */
  private readonly published = new Map<number, Task>()
  private readonly dirty = new Set<number>()
  private snapshot: ReadonlyArray<Task> = []
  private readonly listeners = new Set<() => void>()
  private scheduled = false
  private nextId = 1

  constructor(
    private readonly schedule: (flush: () => void) => void = (flush) => void setTimeout(flush, 50),
    private readonly now: () => number = Date.now
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  readonly getSnapshot = () => this.snapshot

  start(argv: ReadonlyArray<string>): number {
    const id = this.nextId++
    this.drafts.unshift({
      id,
      argv,
      status: "running",
      startedAt: this.now(),
      endedAt: undefined,
      lines: [],
      dropped: 0,
      failure: undefined
    })
    this.changed(id)
    return id
  }

  append(id: number, level: LineLevel, text: string) {
    const draft = this.drafts.find((task) => task.id === id)
    if (draft === undefined) return
    for (const line of toLines(text)) draft.lines.push({ level, text: line })
    const over = draft.lines.length - MAX_LINES
    if (over > 0) {
      draft.lines.splice(0, over)
      draft.dropped += over
    }
    this.changed(id)
  }

  finish(id: number, status: Exclude<TaskStatus, "running">, failure?: string) {
    const draft = this.drafts.find((task) => task.id === id)
    if (draft === undefined || draft.status !== "running") return
    draft.status = status
    draft.endedAt = this.now()
    draft.failure = failure
    this.changed(id)
  }

  /** Forgets the runs that have ended. */
  clearFinished() {
    for (let index = this.drafts.length - 1; index >= 0; index--) {
      const draft = this.drafts[index]!
      if (draft.status === "running") continue
      this.drafts.splice(index, 1)
      this.published.delete(draft.id)
    }
    this.changed()
  }

  /** Publishes now rather than on the next tick, for tests and the last line before quitting. */
  flush() {
    this.scheduled = false
    this.snapshot = this.drafts.map((draft) => {
      const published = this.published.get(draft.id)
      if (published !== undefined && !this.dirty.has(draft.id)) return published
      const task: Task = { ...draft, lines: [...draft.lines] }
      this.published.set(draft.id, task)
      return task
    })
    this.dirty.clear()
    for (const listener of this.listeners) listener()
  }

  private changed(id?: number) {
    if (id !== undefined) this.dirty.add(id)
    if (this.scheduled) return
    this.scheduled = true
    this.schedule(() => this.flush())
  }
}
