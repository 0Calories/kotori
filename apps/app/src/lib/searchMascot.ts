import { useEffect, useRef, useState } from "react"

/**
 * How long a lookup must already be running before Kotori takes the thinking
 * pose. Anything shorter stays on the resting pose, so a fast result never
 * flashes thinking.
 */
export const SEARCH_THINKING_DELAY_MS = 400

/**
 * Once the thinking pose is on screen, keep it at least this long. A result
 * that lands just after the pose appears would otherwise blink it off.
 */
export const SEARCH_THINKING_MIN_MS = 300

/**
 * A pause shorter than this is still the same wait: the next keystroke, or a
 * request that replaced the one in flight. Long enough to cover that idle
 * frame, short enough that a finished search doesn't sit on thinking.
 */
export const SEARCH_THINKING_SETTLE_MS = 100

/**
 * `neutral` is the search field's resting pose (curious). `thinking` is the
 * pose Kotori takes when a lookup has gone on long enough to be worth showing.
 *
 * The thinking pose plays a looping thought bubble. `Mascot` already holds
 * that pose still when the user prefers reduced motion; this module only
 * chooses when to ask for it.
 */
export type SearchMascotPhase = "neutral" | "thinking"

type Pending = "show" | "hide" | "abandon"

type SearchMascotState = {
  readonly loading: boolean
  readonly phase: SearchMascotPhase
  /** When the thinking pose was shown, if it is showing. */
  readonly shownAt: number | null
  /**
   * When a continuous wait should show thinking. Kept across a short gap so
   * the delay doesn't start over between keystrokes or superseded requests.
   */
  readonly showAt: number | null
  readonly pending: Pending | null
  readonly until: number | null
}

const initialSearchMascotState: SearchMascotState = {
  loading: false,
  phase: "neutral",
  shownAt: null,
  showAt: null,
  pending: null,
  until: null
}

type SearchMascotEvent =
  | { readonly type: "loading"; readonly loading: boolean; readonly now: number }
  | { readonly type: "timer"; readonly now: number }

const idle = (): SearchMascotState => ({
  loading: false,
  phase: "neutral",
  shownAt: null,
  showAt: null,
  pending: null,
  until: null
})

const shown = (now: number): SearchMascotState => ({
  loading: true,
  phase: "thinking",
  shownAt: now,
  showAt: null,
  pending: null,
  until: null
})

/**
 * Decides the pose from the latest loading flag and the clock. A timer event
 * means the pending timer reached `until`; the caller cancels a timer it no
 * longer wants rather than delivering it late.
 */
const reduceSearchMascot = (state: SearchMascotState, event: SearchMascotEvent): SearchMascotState => {
  if (event.type === "timer") return onTimer(state, event.now)
  if (event.loading === state.loading) return state
  return event.loading ? onStart(state, event.now) : onStop(state, event.now)
}

const onStart = (state: SearchMascotState, now: number): SearchMascotState => {
  if (state.phase === "thinking") return { ...state, loading: true, pending: null, until: null }
  const showAt = state.showAt ?? now + SEARCH_THINKING_DELAY_MS
  if (now >= showAt) return shown(now)
  return { loading: true, phase: "neutral", shownAt: null, showAt, pending: "show", until: showAt }
}

const onStop = (state: SearchMascotState, now: number): SearchMascotState => {
  if (state.phase === "thinking" && state.shownAt !== null) {
    const remaining = SEARCH_THINKING_MIN_MS - (now - state.shownAt)
    const wait = Math.max(remaining, SEARCH_THINKING_SETTLE_MS)
    return { ...state, loading: false, pending: "hide", until: now + wait }
  }
  // Not on screen yet. Remember the deadline across a short gap, and drop it
  // if the wait really ended, so a fast load never shows thinking.
  if (state.showAt === null) return idle()
  return { ...state, loading: false, pending: "abandon", until: now + SEARCH_THINKING_SETTLE_MS }
}

const onTimer = (state: SearchMascotState, now: number): SearchMascotState => {
  if (state.pending === "show" && state.loading) return shown(now)
  if ((state.pending === "hide" || state.pending === "abandon") && !state.loading) return idle()
  return state
}

export type SearchMascotTiming = {
  readonly phase: SearchMascotPhase
  /** `loading` is true while this lookup is still unresolved, debounce included. */
  setLoading: (loading: boolean) => void
  dispose: () => void
}

/**
 * Runs {@link reduceSearchMascot} on `setTimeout`. `onPhase` fires only when
 * the pose changes. `dispose` drops a pending change, so an unmounted screen
 * doesn't update.
 */
export const createSearchMascotTiming = (
  onPhase: (phase: SearchMascotPhase) => void,
  now: () => number = Date.now
): SearchMascotTiming => {
  let state = initialSearchMascotState
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let disposed = false

  const clear = () => {
    generation += 1
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const apply = (event: SearchMascotEvent) => {
    const next = reduceSearchMascot(state, event)
    if (next === state) return
    const phaseChanged = next.phase !== state.phase
    state = next
    clear()
    if (state.pending !== null && state.until !== null) {
      const due = state.until
      const delay = Math.max(0, due - now())
      const token = generation
      timer = setTimeout(() => {
        if (token !== generation) return
        timer = null
        apply({ type: "timer", now: due })
      }, delay)
    }
    if (phaseChanged) onPhase(state.phase)
  }

  return {
    get phase() {
      return state.phase
    },
    setLoading(loading: boolean) {
      if (disposed) return
      apply({ type: "loading", loading, now: now() })
    },
    dispose() {
      disposed = true
      clear()
    }
  }
}

/**
 * The search field's mascot phase for a lookup that is `loading`. Neutral
 * until the wait is long, then thinking, then neutral again once it has ended
 * — including when the request was cancelled, superseded, or failed.
 */
export const useSearchMascotPhase = (loading: boolean): SearchMascotPhase => {
  const [phase, setPhase] = useState<SearchMascotPhase>("neutral")
  const timing = useRef<SearchMascotTiming | null>(null)

  useEffect(() => {
    const created = createSearchMascotTiming(setPhase)
    timing.current = created
    return () => {
      created.dispose()
      if (timing.current === created) timing.current = null
    }
  }, [])

  useEffect(() => {
    timing.current?.setLoading(loading)
  }, [loading])

  return phase
}
