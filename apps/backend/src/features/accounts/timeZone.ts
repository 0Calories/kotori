/** Whether the runtime knows an IANA time zone, for validating a learner's profile. */
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
