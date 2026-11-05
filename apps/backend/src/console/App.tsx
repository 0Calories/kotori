import { TextAttributes } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { Effect, Exit } from "effect"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Database } from "../db/Database.ts"
import { Approvals } from "../features/accounts/Approvals.ts"
import { proposalCounts } from "../features/asks/review.ts"
import { commandLine, type CommandSpec } from "./model/commands.ts"
import type { Target } from "./model/environment.ts"
import { duration, fit, width as columns } from "./model/format.ts"
import type { ConsoleRuntime } from "./runtime.ts"
import { Hints, Spinner, useNow } from "./ui/components.tsx"
import {
  ConsoleContext,
  type ConsoleContextValue,
  type Section,
  SECTIONS,
  SIDEBAR,
  useConsole,
  useRuns
} from "./ui/context.tsx"
import { KeyRouter, Layer, useKeys } from "./ui/keys.tsx"
import { Modal, OverlayProvider, useOverlay } from "./ui/overlay.tsx"
import { useQuery } from "./ui/query.ts"
import { color, symbol } from "./ui/theme.ts"
import { Accounts } from "./views/Accounts.tsx"
import { Jobs } from "./views/Jobs.tsx"
import { Overview } from "./views/Overview.tsx"
import { Proposals } from "./views/Proposals.tsx"
import { Runs } from "./views/Runs.tsx"

const Header = () => {
  const { target, branch } = useConsole()
  const terminal = useTerminalDimensions()
  const where = `${target.label}${branch !== undefined && !target.local ? ` ${symbol.dot} branch ${branch}` : ""}`
  const kind = target.local ? "local" : "live"
  const left = " 小鳥 Kotori console"
  const right = `${symbol.bullet} ${where}  ${kind} `
  return (
    <box height={1} backgroundColor={color.raised} flexShrink={0}>
      <text>
        <span fg={color.primary} attributes={TextAttributes.BOLD}>
          {left}
        </span>
        <span>{" ".repeat(Math.max(1, terminal.width - columns(left) - columns(right) - 1))}</span>
        <span fg={target.local ? color.ok : color.accent}>{`${symbol.bullet} `}</span>
        <span fg={target.local ? color.text : color.accent} attributes={TextAttributes.BOLD}>
          {where}
        </span>
        <span fg={target.local ? color.ok : color.accent}>{`  ${kind} `}</span>
      </text>
    </box>
  )
}

const Sidebar = () => {
  const { section, waiting, navigate } = useConsole()
  const runs = useRuns()
  const running = runs.filter((run) => run.status === "running").length
  const badge = (id: Section) =>
    id === "accounts" ? waiting.signUps : id === "proposals" ? waiting.proposals : id === "runs" ? running : undefined
  return (
    <box width={SIDEBAR} flexShrink={0} flexDirection="column" paddingTop={1} backgroundColor={color.surface}>
      {SECTIONS.map((each) => {
        const selected = each.id === section
        const count = badge(each.id)
        return (
          <box
            key={each.id}
            height={1}
            onMouseDown={() => navigate(each.id)}
            {...(selected ? { backgroundColor: color.selected } : {})}
          >
            <text>
              <span fg={selected ? color.primary : color.surface}>▌</span>
              <span fg={color.faint}>{`${each.key} `}</span>
              <span fg={selected ? color.text : color.muted} {...(selected ? { attributes: TextAttributes.BOLD } : {})}>
                {fit(each.label, SIDEBAR - 9)}
              </span>
              {each.id === "runs" && running > 0 ? (
                <>
                  <Spinner />
                  <span fg={color.info}>{` ${running}`}</span>
                </>
              ) : count === undefined || count === 0 ? null : (
                <span fg={color.warn} attributes={TextAttributes.BOLD}>
                  {fit(String(count), 3, "right")}
                </span>
              )}
            </text>
          </box>
        )
      })}
    </box>
  )
}

const Footer = () => {
  const runs = useRuns()
  const terminal = useTerminalDimensions()
  const running = runs.filter((run) => run.status === "running")
  const now = useNow(1000)
  const newest = running[0]
  const status =
    newest === undefined
      ? ""
      : `${running.length > 1 ? `${running.length} running ${symbol.dot} ` : ""}${commandLine(newest.argv)} ${symbol.dot} ${duration(now - newest.startedAt)}`
  return (
    <box height={1} flexDirection="row" justifyContent="space-between" backgroundColor={color.raised} flexShrink={0}>
      <Hints
        hints={[
          { key: " 1–5", label: "sections" },
          { key: "?", label: "keys" },
          { key: "q", label: "quit" }
        ]}
      />
      {newest === undefined ? null : (
        <text>
          <Spinner />
          <span fg={color.muted}>{` ${fit(status, Math.max(10, terminal.width - 40))} `}</span>
        </text>
      )}
    </box>
  )
}

const HELP: ReadonlyArray<readonly [string, string]> = [
  ["Everywhere", ""],
  ["1–5  tab", "switch section"],
  ["?", "these keys"],
  ["q  ctrl+c", "quit (asks first while jobs run)"],
  ["`", "the console's own log, for debugging"],
  ["Lists", ""],
  ["↑↓  j k", "move; g G first and last; pgup pgdn a page"],
  ["←→  h l", "filter tabs"],
  ["/", "search; esc clears it"],
  ["r", "refresh"],
  ["Accounts", "a approve · x archive · m admin · o sign out everywhere"],
  ["Proposals", "a approve… · d discard… · e ask again… · v as stored · J K scroll"],
  ["Jobs", "⏎ fill in, then ⏎ run · ↑↓ tab fields · ←→ space change · esc back"],
  ["Runs", "J K space b scroll · F follow · c stop · x clear finished"]
]

const Help = ({ close }: { readonly close: () => void }) => {
  useKeys(
    (key) => {
      if (key.name === "escape" || key.name === "?" || key.name === "q" || key.name === "return") close()
      return true
    },
    { layer: Layer.dialog, modal: true }
  )
  return (
    <Modal title="Keys" width={86}>
      <box flexDirection="column">
        {HELP.map(([keys, what]) =>
          what === "" ? (
            <text key={keys} fg={color.primary} attributes={TextAttributes.BOLD}>
              {keys}
            </text>
          ) : (
            <text key={keys}>
              <span fg={color.text}>{fit(`  ${keys}`, 14)}</span>
              <span fg={color.muted}>{what}</span>
            </text>
          )
        )}
      </box>
      <text fg={color.faint}>Every write asks first, and names the database it goes to.</text>
    </Modal>
  )
}

const Shell = () => {
  const { section, navigate, runtime } = useConsole()
  const overlay = useOverlay()
  const renderer = useRenderer()
  const [help, setHelp] = useState(false)
  const lastInterrupt = useRef(0)

  // Services' warnings, such as an approval email that didn't send, show as toasts.
  useEffect(() => runtime.notices.subscribe((notice) => overlay.toast(notice.level, notice.text)), [overlay, runtime])

  const quit = useCallback(
    async (force: boolean) => {
      const running = runtime.runningJobs()
      if (running > 0 && !force) {
        const ok = await overlay.confirm({
          title: "Quit",
          lines: [
            `${running === 1 ? "A job is" : `${running} jobs are`} still running. Stop and quit?`,
            "Stopping interrupts it where it is: work already saved stays, and a transaction in flight rolls back.",
            "ctrl+c twice quits at once."
          ],
          action: "Stop and quit",
          danger: true
        })
        if (!ok) return
      }
      renderer.destroy()
    },
    [overlay, renderer, runtime]
  )

  useKeys(
    (key) => {
      if (key.name === "ctrl+c") {
        // Once closes a dialog or asks to quit; twice in quick succession quits whatever is running.
        const now = Date.now()
        const again = now - lastInterrupt.current < 2000
        lastInterrupt.current = now
        if (again) void quit(true)
        else if (overlay.open || help) {
          overlay.dismissAll()
          setHelp(false)
        } else void quit(false)
        return true
      }
      const target = SECTIONS.find((each) => each.key === key.name)
      if (target !== undefined) {
        navigate(target.id)
        return true
      }
      const at = SECTIONS.findIndex((each) => each.id === section)
      switch (key.name) {
        case "tab":
          navigate(SECTIONS[(at + 1) % SECTIONS.length]!.id)
          return true
        case "shift+tab":
          navigate(SECTIONS[(at + SECTIONS.length - 1) % SECTIONS.length]!.id)
          return true
        case "?":
          setHelp(true)
          return true
        case "q":
          void quit(false)
          return true
        case "`":
          renderer.console.toggle()
          return true
        default:
          return false
      }
    },
    { layer: Layer.app }
  )

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={color.background}>
      <Header />
      <box flexDirection="row" flexGrow={1}>
        <Sidebar />
        <box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1}>
          {section === "overview" ? (
            <Overview />
          ) : section === "accounts" ? (
            <Accounts />
          ) : section === "proposals" ? (
            <Proposals />
          ) : section === "jobs" ? (
            <Jobs />
          ) : (
            <Runs />
          )}
        </box>
      </box>
      <Footer />
      {help ? <Help close={() => setHelp(false)} /> : null}
    </box>
  )
}

/** The admin console: the CLI's commands as views and forms, over the database `DATABASE_URL` names. */
export const App = ({
  runtime,
  target,
  branch,
  specs
}: {
  readonly runtime: ConsoleRuntime
  readonly target: Target
  readonly branch: string | undefined
  readonly specs: ReadonlyArray<CommandSpec>
}) => {
  const [section, setSection] = useState<Section>("overview")
  const [focusedRun, setFocusedRun] = useState<number | undefined>(undefined)
  const waiting = useQuery("waiting", async () => {
    const [signUps, proposals] = await Promise.all([
      runtime.services.accounts.run(
        Effect.gen(function* () {
          const approvals = yield* Approvals
          return (yield* approvals.requests()).length
        })
      ),
      runtime.services.database.run(
        Effect.gen(function* () {
          return (yield* proposalCounts(yield* Database)).pending
        })
      )
    ])
    return Exit.succeed({
      signUps: Exit.isSuccess(signUps) ? signUps.value : undefined,
      proposals: Exit.isSuccess(proposals) ? proposals.value : undefined
    })
  })

  const value: ConsoleContextValue = useMemo(
    () => ({
      runtime,
      target,
      branch,
      specs,
      section,
      navigate: setSection,
      waiting: waiting.result.state === "ready" ? waiting.result.value : { signUps: undefined, proposals: undefined },
      refreshWaiting: waiting.reload,
      showRun: (id: number) => {
        setFocusedRun(id)
        setSection("runs")
      },
      focusedRun
    }),
    [runtime, target, branch, specs, section, waiting.result, waiting.reload, focusedRun]
  )

  return (
    <KeyRouter>
      <ConsoleContext.Provider value={value}>
        <OverlayProvider target={target}>
          <Shell />
        </OverlayProvider>
      </ConsoleContext.Provider>
    </KeyRouter>
  )
}
