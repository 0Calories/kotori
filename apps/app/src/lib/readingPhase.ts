import { useEffect, useRef, useState } from "react"

/**
 * How long a wait (a dictionary lookup, or a screen loading its content)
 * must already be running before Kotori takes the reading pose. Anything shorter stays on the resting pose, so a fast result never
 * flashes reading.
 */
export const READING_DELAY_MS = 400

/**
 * Once the reading pose is on screen, keep it at least this long. A result
 * that lands just after the pose appears would otherwise blink it off.
 */
export const READING_MIN_MS = 300

/**
 * A pause shorter than this is still the same wait: the next keystroke, or a
 * request that replaced the one in flight. Long enough to cover that idle
 * frame, short enough that a finished wait doesn't sit on reading.
 */
export const READING_SETTLE_MS = 100

/**
 * How long a dictionary search must run before Kotori, held still over the
 * search field, takes its thinking pose. Only a very slow search gets there,
 * so typing and ordinary results leave the resting pose alone.
 */
export const SEARCH_THINKING_DELAY_MS = 2500

/**
 * `reading` is the pose Kotori takes once a wait has gone on long enough to be
 * worth showing; `neutral` is anything else. The search field shows its
 * resting bird when neutral; a loading screen shows nothing.
 *
 * The reading pose plays a loop of Kotori turning pages and reading along
 * the lines. `Mascot` already holds that pose still when the user prefers
 * reduced motion; this module only chooses when to ask for it.
 */
export type ReadingPhase = "neutral" | "reading"

type Pending = "show" | "hide" | "abandon"

type ReadingState = {
  readonly loading: boolean
  readonly phase: ReadingPhase
  /** When the reading pose was shown, if it is showing. */
  readonly shownAt: number | null
  /**
   * When a continuous wait should show reading. Kept across a short gap so
   * the delay doesn't start over between keystrokes or superseded requests.
   */
  readonly showAt: number | null
  readonly pending: Pending | null
  readonly until: number | null
}

const initialReadingState: ReadingState = {
  loading: false,
  phase: "neutral",
  shownAt: null,
  showAt: null,
  pending: null,
  until: null
}

type ReadingEvent =
  | { readonly type: "loading"; readonly loading: boolean; readonly now: number }
  | { readonly type: "timer"; readonly now: number }

const idle = (): ReadingState => ({
  loading: false,
  phase: "neutral",
  shownAt: null,
  showAt: null,
  pending: null,
  until: null
})

const shown = (now: number): ReadingState => ({
  loading: true,
  phase: "reading",
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
const reduceReading = (state: ReadingState, event: ReadingEvent, delay: number): ReadingState => {
  if (event.type === "timer") return onTimer(state, event.now)
  if (event.loading === state.loading) return state
  return event.loading ? onStart(state, event.now, delay) : onStop(state, event.now)
}

const onStart = (state: ReadingState, now: number, delay: number): ReadingState => {
  if (state.phase === "reading") return { ...state, loading: true, pending: null, until: null }
  const showAt = state.showAt ?? now + delay
  if (now >= showAt) return shown(now)
  return { loading: true, phase: "neutral", shownAt: null, showAt, pending: "show", until: showAt }
}

const onStop = (state: ReadingState, now: number): ReadingState => {
  if (state.phase === "reading" && state.shownAt !== null) {
    const remaining = READING_MIN_MS - (now - state.shownAt)
    const wait = Math.max(remaining, READING_SETTLE_MS)
    return { ...state, loading: false, pending: "hide", until: now + wait }
  }
  // Not on screen yet. Remember the deadline across a short gap, and drop it
  // if the wait really ended, so a fast load never shows reading.
  if (state.showAt === null) return idle()
  return { ...state, loading: false, pending: "abandon", until: now + READING_SETTLE_MS }
}

const onTimer = (state: ReadingState, now: number): ReadingState => {
  if (state.pending === "show" && state.loading) return shown(now)
  if ((state.pending === "hide" || state.pending === "abandon") && !state.loading) return idle()
  return state
}

export type ReadingTiming = {
  readonly phase: ReadingPhase
  /** `loading` is true while the wait is still unresolved (for a search, debounce included). */
  setLoading: (loading: boolean) => void
  dispose: () => void
}

/**
 * Runs {@link reduceReading} on `setTimeout`. `onPhase` fires only when
 * the pose changes. A wait shows reading once it has run `delay` ms. `dispose` drops a pending change, so an unmounted screen
 * doesn't update.
 */
export const createReadingTiming = (
  onPhase: (phase: ReadingPhase) => void,
  now: () => number = Date.now,
  delay: number = READING_DELAY_MS
): ReadingTiming => {
  let state = initialReadingState
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let disposed = false

  const clear = () => {
    generation += 1
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const apply = (event: ReadingEvent) => {
    const next = reduceReading(state, event, delay)
    if (next === state) return
    const phaseChanged = next.phase !== state.phase
    state = next
    clear()
    if (state.pending !== null && state.until !== null) {
      const due = state.until
      const token = generation
      timer = setTimeout(
        () => {
          if (token !== generation) return
          timer = null
          apply({ type: "timer", now: due })
        },
        Math.max(0, due - now())
      )
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
 * Kotori's phase for a wait that is `loading`: neutral until the wait is long,
 * then reading, then neutral again once it has ended — including when the
 * request was cancelled, superseded, or failed. A screen that loads its
 * content keeps its loading state up while this is reading, so the pose never
 * blinks off the moment it appears. `delay` is how long the wait must run
 * first.
 */
export const useReadingPhase = (loading: boolean, delay: number = READING_DELAY_MS): ReadingPhase => {
  const [phase, setPhase] = useState<ReadingPhase>("neutral")
  const timing = useRef<ReadingTiming | null>(null)

  useEffect(() => {
    const created = createReadingTiming(setPhase, Date.now, delay)
    timing.current = created
    return () => {
      created.dispose()
      if (timing.current === created) timing.current = null
    }
  }, [delay])

  useEffect(() => {
    timing.current?.setLoading(loading)
  }, [loading])

  return phase
}
