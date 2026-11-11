import { useTerminalDimensions } from "@opentui/react"
import { createContext, useContext, useSyncExternalStore } from "react"
import type { CommandSpec } from "../model/commands.ts"
import type { Target } from "../model/environment.ts"
import type { ConsoleRuntime } from "../runtime.ts"

export const SECTIONS = [
  { id: "overview", label: "Overview", key: "1" },
  { id: "accounts", label: "Accounts", key: "2" },
  { id: "proposals", label: "Proposals", key: "3" },
  { id: "jobs", label: "Jobs", key: "4" },
  { id: "runs", label: "Runs", key: "5" }
] as const

export type Section = (typeof SECTIONS)[number]["id"]

/** Sign-ups and drafts waiting on the admin, for the sidebar and the overview. */
interface Waiting {
  readonly signUps: number | undefined
  readonly proposals: number | undefined
}

export interface ConsoleContextValue {
  readonly runtime: ConsoleRuntime
  readonly target: Target
  /** `NEON_BRANCH`, shown beside a Neon target as a reminder of which branch it is. */
  readonly branch: string | undefined
  readonly specs: ReadonlyArray<CommandSpec>
  readonly section: Section
  readonly navigate: (section: Section) => void
  readonly waiting: Waiting
  /** Counts again, after a view approved or archived something. */
  readonly refreshWaiting: () => void
  /** Opens the runs view on one run, as the jobs view does after starting one. */
  readonly showRun: (id: number) => void
  readonly focusedRun: number | undefined
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null)

export const useConsole = () => {
  const value = useContext(ConsoleContext)
  if (value === null) throw new Error("useConsole outside ConsoleContext")
  return value
}

/** The sidebar's width; the header and the footer take a row each. */
export const SIDEBAR = 22

/** The room a view has, in terminal columns and rows, inside its padding. */
export const useViewSize = () => {
  const terminal = useTerminalDimensions()
  return { width: Math.max(40, terminal.width - SIDEBAR - 3), height: Math.max(10, terminal.height - 3) }
}

/** This session's runs, newest first, kept current as their logs grow. */
export const useRuns = () => {
  const { runtime } = useConsole()
  return useSyncExternalStore(runtime.tasks.subscribe, runtime.tasks.getSnapshot)
}
