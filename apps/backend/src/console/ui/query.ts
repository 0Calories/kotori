import { Exit } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { describeCause } from "../model/describe.ts"

type Loaded<A> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: A; readonly refreshing: boolean }
  | { readonly state: "error"; readonly message: string; readonly refreshing: boolean }

interface Settled<A> {
  readonly key: string
  readonly version: number
  readonly exit: Exit.Exit<A, unknown>
}

/**
 * Answers kept for the session, so returning to a view shows what it had. A view's own query decides
 * how long its answer stays good (`maxAge`); an action that changes the data drops it (`invalidate`).
 */
const cache = new Map<string, { readonly at: number; readonly exit: Exit.Exit<unknown, unknown> }>()

/** Forgets the cached answers whose keys start with `prefix`, so their views load afresh. */
export const invalidate = (prefix: string) => {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

/**
 * Data for a view, loaded when `key` changes and again on `reload`. While a reload runs, the last
 * answer stays on screen marked as refreshing, so lists don't blank out between keystrokes. An answer
 * younger than `maxAge` milliseconds is reused rather than asked for again; `reload` always asks.
 */
export const useQuery = <A>(key: string, load: () => Promise<Exit.Exit<A, unknown>>, maxAge = 0) => {
  const loader = useRef(load)
  useEffect(() => {
    loader.current = load
  })
  const [version, setVersion] = useState(0)
  const [settled, setSettled] = useState<Settled<A> | undefined>(undefined)

  useEffect(() => {
    let live = true
    const hit = cache.get(key)
    const fresh = version === 0 && hit !== undefined && Date.now() - hit.at < maxAge
    const answer = fresh ? Promise.resolve(hit.exit as Exit.Exit<A, unknown>) : loader.current()
    void answer.then((exit) => {
      // Failures aren't kept, so the next visit tries again.
      if (!fresh && Exit.isSuccess(exit)) cache.set(key, { at: Date.now(), exit })
      if (live) setSettled({ key, version, exit })
    })
    return () => {
      live = false
    }
  }, [key, version, maxAge])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const stale = settled === undefined || settled.key !== key || settled.version !== version
  const sameKey = settled !== undefined && settled.key === key

  let result: Loaded<A>
  if (settled === undefined || (!sameKey && stale)) result = { state: "loading" }
  else if (Exit.isSuccess(settled.exit)) result = { state: "ready", value: settled.exit.value, refreshing: stale }
  else result = { state: "error", message: describeCause(settled.exit.cause), refreshing: stale }
  return { result, reload }
}
