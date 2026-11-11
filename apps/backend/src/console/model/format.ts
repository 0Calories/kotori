/** Text and numbers as the console lays them out in fixed-width columns. */

/** Characters a terminal draws two columns wide: CJK, kana, Hangul, fullwidth forms and most emoji. */
const wide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0x303e) ||
  (code >= 0x3041 && code <= 0x33ff) ||
  (code >= 0x3400 && code <= 0x4dbf) ||
  (code >= 0x4e00 && code <= 0x9fff) ||
  (code >= 0xa000 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1f64f) ||
  (code >= 0x1f900 && code <= 0x1f9ff) ||
  (code >= 0x20000 && code <= 0x3fffd)

const zeroWidth = (code: number) =>
  (code >= 0x0300 && code <= 0x036f) || code === 0x200b || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)

/** How many terminal columns the text takes. */
export const width = (text: string) => {
  let columns = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    columns += zeroWidth(code) ? 0 : wide(code) ? 2 : 1
  }
  return columns
}

/** The text cut to `max` columns, ending in an ellipsis when it was cut. */
export const truncate = (text: string, max: number) => {
  if (max <= 0) return ""
  if (width(text) <= max) return text
  let out = ""
  let columns = 0
  for (const char of text) {
    const next = width(char)
    if (columns + next > max - 1) break
    out += char
    columns += next
  }
  return `${out}…`
}

/** The text cut or padded to exactly `columns`. */
export const fit = (text: string, columns: number, align: "left" | "right" = "left") => {
  const cut = truncate(text.replaceAll(/\s+/gu, " "), columns)
  const space = " ".repeat(Math.max(0, columns - width(cut)))
  return align === "left" ? cut + space : space + cut
}

export const number = (n: number) => n.toLocaleString("en-US")

export const percent = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((100 * part) / whole)}%`)

/** How long ago, briefly: `now`, `5m`, `3h`, `2d`, then the date. */
export const ago = (date: Date, now: number) => {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000))
  if (seconds < 45) return "now"
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  if (seconds < 86_400 * 30) return `${Math.round(seconds / 86_400)}d`
  return date.toISOString().slice(0, 10)
}

/** When, in a sentence: `just now`, `5m ago`, `3d ago`, then `on 2026-10-01`. */
export const since = (date: Date, now: number) => {
  const short = ago(date, now)
  return short === "now" ? "just now" : short.includes("-") ? `on ${short}` : `${short} ago`
}

/** `1 line`, `2 lines`. */
export const plural = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`

/** A run's length: `40ms`, `0.4s`, `12s`, `3m 05s`, `1h 02m`. */
export const duration = (ms: number) => {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

/** A meter in block characters, `filled` of `cells` for `part / whole`. */
export const meter = (part: number, whole: number, cells: number) => {
  const ratio = whole <= 0 ? 0 : Math.max(0, Math.min(1, part / whole))
  const filled = Math.round(ratio * cells)
  return { filled: "█".repeat(filled), empty: "░".repeat(cells - filled) }
}
