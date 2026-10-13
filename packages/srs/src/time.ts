const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export interface ReviewContext {
  /** Epoch ms of the answer. */
  readonly now: number
  /** The learner's offset from UTC in minutes (JST = 540). Study days follow the learner's clock. */
  readonly utcOffsetMinutes: number
  /** Local hour at which a new study day starts. Anki defaults to 4am. */
  readonly rolloverHour?: number
  /** Stable per-card seed (e.g. the card id) for deterministic fuzz. */
  readonly seed: number
}

type DayClock = Pick<ReviewContext, "utcOffsetMinutes" | "rolloverHour">

const shift = (clock: DayClock) => clock.utcOffsetMinutes * MINUTE - (clock.rolloverHour ?? 4) * HOUR

/** The study day a timestamp falls in, counted in days since the epoch. */
export const dayNumber = (epochMs: number, clock: DayClock) => Math.floor((epochMs + shift(clock)) / DAY)

/** Epoch ms at which the given study day starts. */
export const dayStart = (day: number, clock: DayClock) => day * DAY - shift(clock)
