import type { Preview } from "./scheduler.ts"

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const trim = (value: number) => (Math.round(value * 10) / 10).toString()

/** Formats a review interval in days the way Anki labels its buttons: "4d", "1.2mo", "2.3y". */
export const formatDays = (days: number) => {
  if (days < 30) return `${Math.max(Math.round(days), 1)}d`
  if (days < 365) return `${trim(days / 30)}mo`
  return `${trim(days / 365)}y`
}

/** Formats a short delay: "<1m", "10m", "1.5h". */
export const formatDelay = (ms: number) => {
  if (ms < MINUTE) return "<1m"
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`
  if (ms < 24 * HOUR) return `${trim(ms / HOUR)}h`
  return formatDays(ms / (24 * HOUR))
}

/** Label for an answer button, given what that answer would schedule. */
export const formatPreview = (preview: Preview, now: number) =>
  preview.queue === "review" ? formatDays(preview.interval) : formatDelay(preview.due - now)
