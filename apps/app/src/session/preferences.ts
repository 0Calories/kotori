import { useCallback, useEffect, useState } from "react"
import { storage } from "./storage"

const listeners = new Map<string, Set<(value: string | null) => void>>()

/** A small persisted preference shared across screens. */
export const usePreference = <A>(key: string, fallback: A) => {
  const [value, setValue] = useState<A>(fallback)

  useEffect(() => {
    let active = true
    storage.get(`kotori.pref.${key}`).then((raw) => {
      if (active && raw !== null) setValue(JSON.parse(raw) as A)
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
      storage.set(`kotori.pref.${key}`, raw)
      listeners.get(key)?.forEach((listener) => listener(raw))
    },
    [key]
  )

  return [value, update] as const
}
