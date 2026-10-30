import { useCallback, useEffect, useState } from "react"
import { storage } from "./storage"

const listeners = new Map<string, Set<(value: string | null) => void>>()

/** A small persisted preference shared across screens, and whether the stored value has been read. */
export const usePreference = <A>(key: string, fallback: A) => {
  const [value, setValue] = useState<A>(fallback)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    // An unreadable or corrupt value leaves the default in place.
    storage
      .get(`kotori.pref.${key}`)
      .then((raw) => {
        if (active && raw !== null) setValue(JSON.parse(raw) as A)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true)
      })
    const listener = (raw: string | null) => setValue(raw === null ? fallback : (JSON.parse(raw) as A))
    const set = listeners.get(key) ?? new Set()
    set.add(listener)
    listeners.set(key, set)
    return () => {
      active = false
      set.delete(listener)
    }
  }, [key])

  const update = useCallback(
    (next: A) => {
      const raw = JSON.stringify(next)
      storage.set(`kotori.pref.${key}`, raw).catch(() => {})
      listeners.get(key)?.forEach((listener) => listener(raw))
    },
    [key]
  )

  return [value, update, loaded] as const
}
