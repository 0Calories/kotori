import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { Target } from "../model/environment.ts"
import { Layer, useKeys } from "./keys.tsx"
import { color, symbol } from "./theme.ts"

export interface Confirmation {
  readonly title: string
  /** What will happen, a line each. */
  readonly lines: ReadonlyArray<string>
  /** The confirm button's label: "Approve", "Run". */
  readonly action: string
  /** It writes to the database, so the target is named, in rose when it's live. */
  readonly writes?: boolean
  readonly danger?: boolean
}

export interface Prompt {
  readonly title: string
  readonly label: string
  readonly initial?: string
  readonly placeholder?: string
  /** A note under the field. */
  readonly note?: string
  readonly action: string
  /** Lines above the field, as a confirmation has. */
  readonly lines?: ReadonlyArray<string>
  readonly writes?: boolean
}

type ToastLevel = "info" | "ok" | "warn" | "error"

interface Toast {
  readonly id: number
  readonly level: ToastLevel
  readonly text: string
}

interface Overlay {
  readonly confirm: (confirmation: Confirmation) => Promise<boolean>
  readonly prompt: (prompt: Prompt) => Promise<string | undefined>
  readonly toast: (level: ToastLevel, text: string) => void
  /**
   * Shows a view's own dialog over the whole screen, where `Modal` can centre it: OpenTUI places
   * an absolute box within its parent, so a dialog drawn inside a view would sit in the view.
   */
  readonly present: (dialog: ReactNode) => void
  readonly dismiss: () => void
  /** Closes whatever dialog is open, as cancelled. */
  readonly dismissAll: () => void
  /** A dialog is open, so views should leave the keys to it. */
  readonly open: boolean
}

const OverlayContext = createContext<Overlay | null>(null)

export const useOverlay = () => {
  const overlay = useContext(OverlayContext)
  if (overlay === null) throw new Error("useOverlay outside OverlayProvider")
  return overlay
}

/** A centred box above everything else, with the dialog's keys. */
export const Modal = ({
  title,
  width,
  children,
  tone = "normal"
}: {
  readonly title: string
  readonly width: number
  readonly children: ReactNode
  readonly tone?: "normal" | "danger"
}) => {
  const terminal = useTerminalDimensions()
  const boxWidth = Math.min(width, terminal.width - 4)
  const top = Math.max(1, Math.floor(terminal.height / 10))
  return (
    <>
      <Scrim />
      <box
        position="absolute"
        left={Math.max(0, Math.floor((terminal.width - boxWidth) / 2))}
        top={top}
        width={boxWidth}
        maxHeight={terminal.height - top - 1}
        zIndex={100}
        border
        borderStyle="rounded"
        borderColor={tone === "danger" ? color.accent : color.primary}
        backgroundColor={color.surface}
        title={` ${title} `}
        titleColor={tone === "danger" ? color.accent : color.primary}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        {children}
      </box>
    </>
  )
}

/** Dims the screen behind a dialog, so the dialog is what reads. */
const Scrim = () => {
  const terminal = useTerminalDimensions()
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={terminal.width}
      height={terminal.height}
      zIndex={99}
      backgroundColor={color.scrim}
    />
  )
}

/** Where a write lands, called out in rose when it isn't a local database. */
export const TargetLine = ({ target }: { readonly target: Target }) => (
  <text flexShrink={0}>
    <span fg={target.local ? color.ok : color.accent}>{`${symbol.bullet} `}</span>
    <span fg={target.local ? color.text : color.accent} attributes={TextAttributes.BOLD}>
      {target.label}
    </span>
    <span fg={color.muted}>{target.local ? "  local database" : "  live database"}</span>
  </text>
)

const Buttons = ({ action, danger }: { readonly action: string; readonly danger?: boolean | undefined }) => (
  <text flexShrink={0}>
    <span bg={danger === true ? color.accentSoft : color.primarySoft} fg={color.text} attributes={TextAttributes.BOLD}>
      {` ⏎ ${action} `}
    </span>
    <span fg={color.muted}>{"   esc cancel"}</span>
  </text>
)

const ConfirmDialog = ({
  confirmation,
  target,
  settle
}: {
  readonly confirmation: Confirmation
  readonly target: Target
  readonly settle: (ok: boolean) => void
}) => {
  useKeys(
    (key) => {
      if (key.name === "return" || key.name === "y") settle(true)
      else if (key.name === "escape" || key.name === "n" || key.name === "q") settle(false)
      return true
    },
    { layer: Layer.dialog, modal: true }
  )
  return (
    <Modal title={confirmation.title} width={72} tone={confirmation.danger === true ? "danger" : "normal"}>
      <box flexDirection="column">
        {confirmation.lines.map((line) => (
          <text key={line} fg={color.text}>
            {line}
          </text>
        ))}
      </box>
      {confirmation.writes === true ? <TargetLine target={target} /> : null}
      <Buttons action={confirmation.action} danger={confirmation.danger} />
    </Modal>
  )
}

const PromptDialog = ({
  prompt,
  target,
  settle
}: {
  readonly prompt: Prompt
  readonly target: Target
  readonly settle: (value: string | undefined) => void
}) => {
  const value = useRef(prompt.initial ?? "")
  useKeys(
    (key) => {
      if (key.name === "return") settle(value.current)
      else if (key.name === "escape") settle(undefined)
      else return false
      return true
    },
    { layer: Layer.dialog, modal: true }
  )
  return (
    <Modal title={prompt.title} width={72}>
      {prompt.lines === undefined ? null : (
        <box flexDirection="column">
          {prompt.lines.map((line) => (
            <text key={line} fg={color.text}>
              {line}
            </text>
          ))}
        </box>
      )}
      <box flexDirection="column">
        <text fg={color.muted}>{prompt.label}</text>
        <box border borderStyle="rounded" borderColor={color.primary} height={3}>
          <input
            focused
            value={prompt.initial ?? ""}
            placeholder={prompt.placeholder ?? ""}
            onInput={(next: string) => void (value.current = next)}
            backgroundColor={color.surface}
            focusedBackgroundColor={color.surface}
            textColor={color.text}
            focusedTextColor={color.text}
            placeholderColor={color.faint}
          />
        </box>
        {prompt.note === undefined ? null : <text fg={color.faint}>{prompt.note}</text>}
      </box>
      {prompt.writes === true ? <TargetLine target={target} /> : null}
      <Buttons action={prompt.action} />
    </Modal>
  )
}

const toastLook: Readonly<Record<ToastLevel, { readonly fg: string; readonly icon: string }>> = {
  info: { fg: color.info, icon: "i" },
  ok: { fg: color.ok, icon: symbol.check },
  warn: { fg: color.warn, icon: symbol.warning },
  error: { fg: color.danger, icon: symbol.cross }
}

const Toasts = ({ toasts }: { readonly toasts: ReadonlyArray<Toast> }) => {
  const terminal = useTerminalDimensions()
  const boxWidth = Math.min(64, terminal.width - 4)
  if (toasts.length === 0) return null
  return (
    <box position="absolute" right={2} bottom={2} width={boxWidth} zIndex={90} flexDirection="column" gap={0}>
      {toasts.map((toast) => (
        <box
          key={toast.id}
          border
          borderStyle="rounded"
          borderColor={toastLook[toast.level].fg}
          backgroundColor={color.surface}
          paddingLeft={1}
          paddingRight={1}
        >
          <text>
            <span
              fg={toastLook[toast.level].fg}
              attributes={TextAttributes.BOLD}
            >{`${toastLook[toast.level].icon} `}</span>
            <span fg={color.text}>{toast.text}</span>
          </text>
        </box>
      ))}
    </box>
  )
}

type Pending =
  | { readonly kind: "confirm"; readonly confirmation: Confirmation; readonly settle: (ok: boolean) => void }
  | { readonly kind: "prompt"; readonly prompt: Prompt; readonly settle: (value: string | undefined) => void }

/** Dialogs and toasts for the views, one dialog at a time. */
export const OverlayProvider = ({ target, children }: { readonly target: Target; readonly children: ReactNode }) => {
  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const pendingRef = useRef<Pending | undefined>(undefined)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  const [presented, setPresented] = useState<ReactNode>(undefined)
  const [toasts, setToasts] = useState<ReadonlyArray<Toast>>([])
  const nextToast = useRef(1)

  const toast = useCallback((level: ToastLevel, text: string) => {
    const id = nextToast.current++
    setToasts((shown) => [...shown.slice(-2), { id, level, text }])
    setTimeout(
      () => setToasts((shown) => shown.filter((other) => other.id !== id)),
      level === "error" ? 9000 : level === "warn" ? 7000 : 4500
    )
  }, [])

  const confirm = useCallback(
    (confirmation: Confirmation) =>
      new Promise<boolean>((resolve) =>
        setPending({
          kind: "confirm",
          confirmation,
          settle: (ok) => {
            setPending(undefined)
            resolve(ok)
          }
        })
      ),
    []
  )

  const prompt = useCallback(
    (options: Prompt) =>
      new Promise<string | undefined>((resolve) =>
        setPending({
          kind: "prompt",
          prompt: options,
          settle: (value) => {
            setPending(undefined)
            resolve(value)
          }
        })
      ),
    []
  )

  const present = useCallback((dialog: ReactNode) => setPresented(dialog), [])
  const dismiss = useCallback(() => setPresented(undefined), [])
  const dismissAll = useCallback(() => {
    const open = pendingRef.current
    if (open?.kind === "confirm") open.settle(false)
    else open?.settle(undefined)
    setPresented(undefined)
  }, [])

  const value = useMemo(
    () => ({
      confirm,
      prompt,
      toast,
      present,
      dismiss,
      dismissAll,
      open: pending !== undefined || presented !== undefined
    }),
    [confirm, prompt, toast, present, dismiss, dismissAll, pending, presented]
  )

  return (
    <OverlayContext.Provider value={value}>
      {children}
      {presented}
      <Toasts toasts={toasts} />
      {pending?.kind === "confirm" ? (
        <ConfirmDialog confirmation={pending.confirmation} target={target} settle={pending.settle} />
      ) : pending?.kind === "prompt" ? (
        <PromptDialog prompt={pending.prompt} target={target} settle={pending.settle} />
      ) : null}
    </OverlayContext.Provider>
  )
}
