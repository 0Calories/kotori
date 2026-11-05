import type { KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react"

/**
 * Keys go to one handler at a time, nearest the user first: an open dialog, then the focused
 * panel, then the view, then the console's own keys. A handler that uses a key returns true, and
 * nothing below it, including a focused text field, sees that key. A modal scope (a dialog, or a
 * form being typed into) also hides every other key from the layers below, so typing a "q" into a
 * field never quits.
 */
export const Layer = { app: 0, view: 10, panel: 20, dialog: 30 } as const

export type KeyHandler = (key: Key) => boolean | void

/** A key press as the console matches it: `q`, `G`, `?`, `return`, `escape`, `ctrl+c`, `shift+tab`. */
export interface Key {
  readonly name: string
  /** The character typed, for text fields; empty for keys that type nothing. */
  readonly text: string
  readonly event: KeyEvent
}

const printable = (sequence: string) => sequence.length === 1 && sequence >= " " && sequence !== "\u007f"

const toKey = (event: KeyEvent): Key => {
  const base = printable(event.sequence) && !event.ctrl && !event.meta ? event.sequence : event.name
  const prefix = `${event.ctrl ? "ctrl+" : ""}${event.meta || event.option ? "alt+" : ""}`
  const shifted = event.shift && !printable(event.sequence) ? "shift+" : ""
  return {
    name: `${prefix}${shifted}${base === " " ? "space" : base}`,
    text: printable(event.sequence) ? event.sequence : "",
    event
  }
}

interface Scope {
  readonly layer: number
  readonly modal: boolean
  readonly handler: { current: KeyHandler }
  readonly active: { current: boolean }
  order: number
}

const KeysContext = createContext<{ readonly register: (scope: Scope) => () => void } | null>(null)

export const KeyRouter = ({ children }: { readonly children: ReactNode }) => {
  const scopes = useRef<Array<Scope>>([])
  const next = useRef(0)
  useKeyboard((event) => {
    const key = toKey(event)
    // ctrl+c always reaches the console's own keys, however a dialog or a text field holds the rest.
    const ordered = scopes.current
      .filter((scope) => scope.active.current && (key.name !== "ctrl+c" || scope.layer === Layer.app))
      .toSorted((a, b) => b.layer - a.layer || b.order - a.order)
    for (const scope of ordered) {
      if (scope.handler.current(key) === true) {
        event.preventDefault()
        return
      }
      if (scope.modal) return
    }
  })
  const value = useMemo(
    () => ({
      register: (scope: Scope) => {
        scope.order = next.current++
        scopes.current.push(scope)
        return () => {
          scopes.current = scopes.current.filter((other) => other !== scope)
        }
      }
    }),
    []
  )
  return <KeysContext.Provider value={value}>{children}</KeysContext.Provider>
}

/** Handles keys at `layer` while `active` (default true). See `Layer`. */
export const useKeys = (
  handler: KeyHandler,
  options: { readonly layer: number; readonly active?: boolean; readonly modal?: boolean }
) => {
  const context = useContext(KeysContext)
  const handlerRef = useRef(handler)
  const activeRef = useRef(options.active ?? true)
  useEffect(() => {
    handlerRef.current = handler
    activeRef.current = options.active ?? true
  })
  const { layer, modal = false } = options
  useEffect(() => {
    if (context === null) return
    return context.register({ layer, modal, handler: handlerRef, active: activeRef, order: 0 })
  }, [context, layer, modal])
}

/** Up and down in a list, with vim's j and k, page keys and the ends. Returns the new index, or undefined. */
export const moveIn = (key: Key, index: number, length: number, page = 10): number | undefined => {
  if (length === 0) return undefined
  const clamp = (value: number) => Math.max(0, Math.min(length - 1, value))
  switch (key.name) {
    case "up":
    case "k":
      return clamp(index - 1)
    case "down":
    case "j":
      return clamp(index + 1)
    case "pageup":
    case "ctrl+u":
      return clamp(index - page)
    case "pagedown":
    case "ctrl+d":
      return clamp(index + page)
    case "home":
    case "g":
      return 0
    case "end":
    case "G":
      return length - 1
    default:
      return undefined
  }
}
