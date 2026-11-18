/**
 * Anki's SM-2 scheduler (the "v3" scheduler, without FSRS), ported from
 * rslib/src/scheduler/states. Behaviour that learners rely on is kept intact:
 * learning steps, graduating/easy intervals, ease adjustments, late/early
 * review credit, lapses with relearning steps, leech detection and fuzz.
 */
import type { RetentionStage, Rating } from "@kotori/contracts"
import { defaultConfig, type SchedulerConfig } from "./config.ts"
import { dayNumber, dayStart, type ReviewContext } from "./time.ts"

export type { RetentionStage, Rating }
export const ratings: ReadonlyArray<Rating> = ["again", "hard", "good", "easy"]

export interface NoteState {
  readonly retentionStage: RetentionStage
  /** Epoch ms when the note is next due. Review notes are due at the start of a study day. */
  readonly due: number
  /** Review interval in days. For relearning notes, the interval they return to review with. */
  readonly interval: number
  /** Ease factor (2.5 = 250%). Zero until the note first graduates. */
  readonly ease: number
  /** Index into the (re)learning steps. */
  readonly step: number
  readonly reps: number
  readonly lapses: number
  readonly lastReview: number | null
}

export interface ReviewLog {
  readonly rating: Rating
  readonly retentionStageBefore: RetentionStage
  readonly retentionStage: RetentionStage
  readonly intervalBefore: number
  readonly interval: number
  readonly easeBefore: number
  readonly ease: number
  /** Milliseconds until the note is due again. */
  readonly delay: number
  /** True when this answer pushed the note over the leech threshold. */
  readonly leech: boolean
}

export interface ReviewOutcome {
  readonly note: NoteState
  readonly log: ReviewLog
}

export const newNote = (now: number): NoteState => ({
  retentionStage: "new",
  due: now,
  interval: 0,
  ease: 0,
  step: 0,
  reps: 0,
  lapses: 0,
  lastReview: null
})

const DAY_SECS = 86_400
const MIN_EASE = 1.3

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const round2 = (value: number) => Math.round(value * 100) / 100

// ---------------------------------------------------------------------------
// Fuzz (rslib/src/scheduler/states/fuzz.rs)
// ---------------------------------------------------------------------------

const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Number.POSITIVE_INFINITY, factor: 0.05 }
] as const

const fuzzDelta = (interval: number) =>
  interval < 2.5
    ? 0
    : FUZZ_RANGES.reduce(
        (delta, range) => delta + range.factor * Math.max(Math.min(interval, range.end) - range.start, 0),
        1
      )

const constrainedFuzzBounds = (interval: number, minimum: number, maximum: number): [number, number] => {
  const min = Math.min(minimum, maximum)
  const clamped = clamp(interval, min, maximum)
  const delta = fuzzDelta(clamped)
  const lower = clamp(Math.round(clamped - delta), min, maximum)
  let upper = clamp(Math.round(clamped + delta), min, maximum)
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1
  return [lower, upper]
}

/** Mulberry32: a tiny deterministic PRNG, so the intervals shown on answer buttons match the real outcome. */
const fuzzFactor = (seed: number, reps: number) => {
  let t = (seed + reps * 0x9e3779b9) >>> 0
  t = (t + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

interface Scheduler {
  readonly config: SchedulerConfig
  readonly ctx: ReviewContext
  readonly fuzz: number | null
}

const reviewBounds = (s: Scheduler, minimum: number): [number, number] => {
  const maximum = Math.max(s.config.maximumInterval, 1)
  return [clamp(minimum, 1, maximum), maximum]
}

const withReviewFuzz = (s: Scheduler, interval: number, minimum: number, maximum: number) => {
  if (s.fuzz === null) return clamp(Math.round(interval), minimum, maximum)
  const [lower, upper] = constrainedFuzzBounds(interval, minimum, maximum)
  return Math.floor(lower + s.fuzz * (1 + upper - lower))
}

const constrainPassingInterval = (s: Scheduler, interval: number, minimum: number, fuzz: boolean) => {
  const [min, max] = reviewBounds(s, minimum)
  const adjusted = interval * s.config.intervalModifier
  return fuzz ? withReviewFuzz(s, adjusted, min, max) : clamp(Math.round(adjusted), min, max)
}

const withLearningFuzz = (s: Scheduler, secs: number) => {
  if (s.fuzz === null) return secs
  const upperExclusive = secs + Math.floor(Math.min(secs * 0.25, 300))
  return secs >= upperExclusive ? secs : secs + Math.floor(s.fuzz * (upperExclusive - secs))
}

/** Delays longer than a day are rounded to whole days, as Anki does. */
const maybeRoundInDays = (secs: number) => (secs > DAY_SECS ? Math.round(secs / DAY_SECS) * DAY_SECS : secs)

const stepSecs = (steps: ReadonlyArray<number>, index: number) => {
  const minutes = steps[index]
  return minutes === undefined ? undefined : Math.round(minutes * 60)
}

const hardDelaySecs = (steps: ReadonlyArray<number>, index: number) => {
  const current = stepSecs(steps, index)
  if (current === undefined) return undefined
  if (index > 0) return current
  const next = stepSecs(steps, 1)
  const delay = next !== undefined ? (current + next) / 2 : Math.min((current * 3) / 2, current + DAY_SECS)
  return maybeRoundInDays(Math.floor(delay))
}

const today = (s: Scheduler) => dayNumber(s.ctx.now, s.ctx)

interface Next {
  readonly retentionStage: RetentionStage
  readonly step: number
  readonly interval: number
  readonly ease: number
  readonly lapses: number
  /** Learning delay in seconds; review notes are scheduled by interval instead. */
  readonly delaySecs?: number
  readonly leech?: boolean
}

const toReview = (interval: number, ease: number, lapses: number): Next => ({
  retentionStage: "review",
  step: 0,
  interval,
  ease,
  lapses
})

const learning = (
  s: Scheduler,
  retentionStage: "learning" | "relearning",
  step: number,
  secs: number,
  note: Omit<Next, "retentionStage" | "step">
): Next => ({
  ...note,
  retentionStage,
  step,
  delaySecs: withLearningFuzz(s, secs)
})

const answerLearning = (s: Scheduler, note: NoteState, rating: Rating): Next => {
  const steps = s.config.learningSteps
  const ease = s.config.startingEase
  const index = Math.min(note.step, Math.max(steps.length - 1, 0))
  const base = { interval: 0, ease: 0, lapses: note.lapses }

  const graduate = () => {
    const [min, max] = reviewBounds(s, 1)
    return toReview(withReviewFuzz(s, s.config.graduatingInterval, min, max), ease, note.lapses)
  }

  switch (rating) {
    case "again": {
      const secs = stepSecs(steps, 0)
      return secs === undefined ? graduate() : learning(s, "learning", 0, secs, base)
    }
    case "hard": {
      const secs = hardDelaySecs(steps, index)
      return secs === undefined ? graduate() : learning(s, "learning", index, secs, base)
    }
    case "good": {
      const secs = stepSecs(steps, index + 1)
      return secs === undefined ? graduate() : learning(s, "learning", index + 1, secs, base)
    }
    case "easy": {
      const [min, max] = reviewBounds(s, s.config.graduatingInterval + 1)
      return toReview(withReviewFuzz(s, s.config.easyInterval, min, max), ease, note.lapses)
    }
  }
}

const isLeech = (lapses: number, threshold: number) => {
  if (threshold <= 0) return false
  const half = Math.max(Math.floor(threshold / 2), 1)
  return lapses >= threshold && (lapses - threshold) % half === 0
}

const passingIntervals = (s: Scheduler, note: NoteState) => {
  const scheduled = note.interval
  const daysLate = today(s) - dayNumber(note.due, s.ctx)
  const { hardMultiplier, easyBonus } = s.config

  if (daysLate < 0) {
    const elapsed = scheduled + daysLate
    const hard = constrainPassingInterval(
      s,
      Math.max(elapsed * hardMultiplier, scheduled * (hardMultiplier / 2)),
      0,
      false
    )
    const good = constrainPassingInterval(s, Math.max(elapsed * note.ease, scheduled), 0, false)
    const reducedBonus = easyBonus - (easyBonus - 1) / 2
    const easy = constrainPassingInterval(s, Math.max(elapsed * note.ease, scheduled) * reducedBonus, 0, false)
    return { hard, good, easy }
  }

  const hardMinimum = hardMultiplier <= 1 ? 0 : scheduled + 1
  const hard = constrainPassingInterval(s, scheduled * hardMultiplier, hardMinimum, true)
  const goodMinimum = hardMultiplier <= 1 ? scheduled + 1 : hard + 1
  const good = constrainPassingInterval(s, (scheduled + daysLate / 2) * note.ease, goodMinimum, true)
  const easy = constrainPassingInterval(s, (scheduled + daysLate) * note.ease * easyBonus, good + 1, true)
  return { hard, good, easy }
}

const answerReview = (s: Scheduler, note: NoteState, rating: Rating): Next => {
  if (rating === "again") {
    const lapses = note.lapses + 1
    const ease = Math.max(round2(note.ease - 0.2), MIN_EASE)
    const [min, max] = reviewBounds(s, s.config.minimumInterval)
    const interval = clamp(Math.round(note.interval * s.config.lapseMultiplier), min, max)
    const leech = isLeech(lapses, s.config.leechThreshold)
    const secs = stepSecs(s.config.relearningSteps, 0)
    return secs === undefined
      ? { ...toReview(interval, ease, lapses), leech }
      : { ...learning(s, "relearning", 0, secs, { interval, ease, lapses }), leech }
  }

  const { hard, good, easy } = passingIntervals(s, note)
  switch (rating) {
    case "hard":
      return toReview(hard, Math.max(round2(note.ease - 0.15), MIN_EASE), note.lapses)
    case "good":
      return toReview(good, note.ease, note.lapses)
    case "easy":
      return toReview(easy, round2(note.ease + 0.15), note.lapses)
  }
}

const answerRelearning = (s: Scheduler, note: NoteState, rating: Rating): Next => {
  const steps = s.config.relearningSteps
  const index = Math.min(note.step, Math.max(steps.length - 1, 0))
  const base = { interval: note.interval, ease: note.ease, lapses: note.lapses }
  const backToReview = () => toReview(note.interval, note.ease, note.lapses)

  switch (rating) {
    case "again": {
      const secs = stepSecs(steps, 0)
      return secs === undefined ? backToReview() : learning(s, "relearning", 0, secs, base)
    }
    case "hard": {
      const secs = hardDelaySecs(steps, index)
      return secs === undefined ? backToReview() : learning(s, "relearning", index, secs, base)
    }
    case "good": {
      const secs = stepSecs(steps, index + 1)
      return secs === undefined ? backToReview() : learning(s, "relearning", index + 1, secs, base)
    }
    case "easy": {
      const [min, max] = reviewBounds(s, 1)
      return toReview(clamp(note.interval + 1, min, max), note.ease, note.lapses)
    }
  }
}

/** Answers a note, returning its next state and a review log entry. */
export const answer = (
  note: NoteState,
  rating: Rating,
  ctx: ReviewContext,
  config: SchedulerConfig = defaultConfig
): ReviewOutcome => {
  const s: Scheduler = { config, ctx, fuzz: config.fuzz ? fuzzFactor(ctx.seed, note.reps) : null }

  const next =
    note.retentionStage === "review"
      ? answerReview(s, note, rating)
      : note.retentionStage === "relearning"
        ? answerRelearning(s, note, rating)
        : answerLearning(s, note, rating)

  const due = next.delaySecs !== undefined ? ctx.now + next.delaySecs * 1000 : dayStart(today(s) + next.interval, ctx)

  const updated: NoteState = {
    retentionStage: next.retentionStage,
    due,
    interval: next.interval,
    ease: next.ease,
    step: next.step,
    reps: note.reps + 1,
    lapses: next.lapses,
    lastReview: ctx.now
  }

  return {
    note: updated,
    log: {
      rating,
      retentionStageBefore: note.retentionStage,
      retentionStage: updated.retentionStage,
      intervalBefore: note.interval,
      interval: updated.interval,
      easeBefore: note.ease,
      ease: updated.ease,
      delay: due - ctx.now,
      leech: next.leech ?? false
    }
  }
}

export interface Preview {
  readonly retentionStage: RetentionStage
  readonly due: number
  readonly interval: number
}

/** The outcome of each answer button, for labelling them ("10m", "1d", "4d"…). */
export const preview = (
  note: NoteState,
  ctx: ReviewContext,
  config: SchedulerConfig = defaultConfig
): Record<Rating, Preview> => {
  const of = (rating: Rating): Preview => {
    const { note: next } = answer(note, rating, ctx, config)
    return { retentionStage: next.retentionStage, due: next.due, interval: next.interval }
  }
  return { again: of("again"), hard: of("hard"), good: of("good"), easy: of("easy") }
}
