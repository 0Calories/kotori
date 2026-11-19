import { useEffect, useRef, useState } from "react"

export const READING_DELAY_MS = 400

export const READING_MIN_MS = 300

export const READING_SETTLE_MS = 100

export const SEARCH_THINKING_DELAY_MS = 2500

export type ReadingPhase = "neutral" | "reading"

type Pending = "show" | "hide" | "abandon"

type ReadingState = {
  readonly loading: boolean
  readonly phase: ReadingPhase
  readonly shownAt: number | null
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
  if (state.showAt === null) return idle()
  // Hold showAt across brief gaps so back-to-back keystrokes or superseded queries don't reset the delay.
  return { ...state, loading: false, pending: "abandon", until: now + READING_SETTLE_MS }
}

const onTimer = (state: ReadingState, now: number): ReadingState => {
  if (state.pending === "show" && state.loading) return shown(now)
  if ((state.pending === "hide" || state.pending === "abandon") && !state.loading) return idle()
  return state
}

export type ReadingTiming = {
  readonly phase: ReadingPhase
  setLoading: (loading: boolean) => void
  dispose: () => void
}

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
