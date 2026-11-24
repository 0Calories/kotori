import type { EntryId, Note } from "@kotori/contracts"
import { ApiError } from "../api/errors.ts"
import type { Strings } from "../i18n/strings.ts"

export const noteOn = (notes: ReadonlyArray<Note> | undefined, entryId: EntryId): Note | undefined =>
  notes?.find((note) => note.entry.id === entryId)

export const noteErrorText = (t: Strings, error: unknown, action: "save" | "remove"): string => {
  if (error instanceof ApiError && error.tag === "Offline") return t.common.offline
  switch (action) {
    case "save":
      return t.notebook.saveFailed
    case "remove":
      return t.notebook.removeFailed
  }
}

export const noteGlosses = (note: Note): string => {
  const glossSeparator = note.entry.language === "ja" ? "; " : "、"
  return note.senses
    .map((sense) => sense.glosses.slice(0, 2).join(glossSeparator))
    .join(note.entry.language === "ja" ? " / " : "／")
}
