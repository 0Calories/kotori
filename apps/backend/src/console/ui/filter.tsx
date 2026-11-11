import { useState } from "react"
import { Layer, useKeys } from "./keys.tsx"
import { color } from "./theme.ts"

/** A list's search text, typed after `/`. While typing, every key goes to the field. */
export const useFilter = () => {
  const [text, setText] = useState("")
  const [editing, setEditing] = useState(false)
  const needle = text.trim().toLowerCase()
  return {
    text,
    editing,
    open: () => setEditing(true),
    close: () => setEditing(false),
    clear: () => {
      setText("")
      setEditing(false)
    },
    set: setText,
    matches: (haystack: string) => needle.length === 0 || haystack.toLowerCase().includes(needle)
  }
}

export type FilterState = ReturnType<typeof useFilter>

/** The search field: `/` opens it, ⏎ keeps the search, esc clears it. */
export const Filter = ({ filter }: { readonly filter: FilterState }) => {
  useKeys(
    (key) => {
      if (key.name === "escape") filter.clear()
      else if (key.name === "return" || key.name === "up" || key.name === "down" || key.name === "tab") filter.close()
      else return false
      return true
    },
    { layer: Layer.panel, active: filter.editing, modal: true }
  )
  if (!filter.editing && filter.text.length === 0) return null
  return (
    <box flexDirection="row" width={34} height={1}>
      <text fg={color.primary}>/ </text>
      {filter.editing ? (
        <input
          focused
          width={30}
          value={filter.text}
          onInput={filter.set}
          backgroundColor={color.raised}
          focusedBackgroundColor={color.raised}
          textColor={color.text}
          focusedTextColor={color.text}
        />
      ) : (
        <text fg={color.text}>{filter.text}</text>
      )}
    </box>
  )
}
