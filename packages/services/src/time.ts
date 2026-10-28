/** Minutes east of UTC for an IANA time zone at a given instant (JST = 540). */
export const utcOffsetMinutes = (timeZone: string, at: number) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric"
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"))
  return Math.round((local - Math.floor(at / 1000) * 1000) / 60_000)
}

export const isTimeZone = (timeZone: string) => {
  try {
    // Constructing the formatter is the validation: it throws on an unknown zone.
    // oxlint-disable-next-line no-new
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}
