import { describe, expect, it } from "vitest"
import {
  answer,
  type NoteState,
  defaultConfig,
  type ReviewContext,
  newNote,
  preview,
  type SchedulerConfig
} from "../src/index.ts"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// 2026-10-12 12:00 JST (UTC+9). The study day rolls over at 04:00 local time.
const NOON_JST = Date.UTC(2026, 9, 12, 3, 0)
const JST = 9 * 60
const ctx = (now = NOON_JST): ReviewContext => ({ now, utcOffsetMinutes: JST, seed: 42 })
const noFuzz: SchedulerConfig = { ...defaultConfig, fuzz: false }

/** Start of the study day `days` after the day containing `now`. */
const studyDayStart = (now: number, days: number) => {
  const local = now + JST * MINUTE - 4 * HOUR
  const day = Math.floor(local / DAY) + days
  return day * DAY - JST * MINUTE + 4 * HOUR
}

const reviewNote = (overrides: Partial<NoteState> = {}): NoteState => ({
  ...newNote(NOON_JST - 30 * DAY),
  retentionStage: "review",
  interval: 10,
  ease: 2.5,
  reps: 5,
  due: studyDayStart(NOON_JST, 0),
  lastReview: studyDayStart(NOON_JST, -10),
  ...overrides
})

describe("new notes", () => {
  const note = newNote(NOON_JST)

  it("again restarts the first learning step", () => {
    const { note: next } = answer(note, "again", ctx(), noFuzz)
    expect(next.retentionStage).toBe("learning")
    expect(next.step).toBe(0)
    expect(next.due - NOON_JST).toBe(1 * MINUTE)
  })

  it("hard on the first step waits the average of the first two steps", () => {
    const { note: next } = answer(note, "hard", ctx(), noFuzz)
    expect(next.retentionStage).toBe("learning")
    expect(next.step).toBe(0)
    expect(next.due - NOON_JST).toBe(5.5 * MINUTE)
  })

  it("hard with a single learning step waits 1.5x that step", () => {
    const { note: next } = answer(note, "hard", ctx(), { ...noFuzz, learningSteps: [10] })
    expect(next.due - NOON_JST).toBe(15 * MINUTE)
  })

  it("good advances to the next learning step", () => {
    const { note: next } = answer(note, "good", ctx(), noFuzz)
    expect(next.retentionStage).toBe("learning")
    expect(next.step).toBe(1)
    expect(next.due - NOON_JST).toBe(10 * MINUTE)
  })

  it("easy graduates immediately with the easy interval", () => {
    const { note: next } = answer(note, "easy", ctx(), noFuzz)
    expect(next.retentionStage).toBe("review")
    expect(next.interval).toBe(4)
    expect(next.ease).toBe(2.5)
    expect(next.due).toBe(studyDayStart(NOON_JST, 4))
  })

  it("good graduates when there is only one learning step", () => {
    const { note: next } = answer(note, "good", ctx(), { ...noFuzz, learningSteps: [10] })
    expect(next.retentionStage).toBe("review")
    expect(next.interval).toBe(1)
  })

  it("counts every answer as a repetition", () => {
    const { note: next } = answer(note, "again", ctx(), noFuzz)
    expect(next.reps).toBe(1)
    expect(next.lastReview).toBe(NOON_JST)
  })
})

describe("learning notes", () => {
  const onLastStep: NoteState = { ...newNote(NOON_JST), retentionStage: "learning", step: 1, reps: 1, due: NOON_JST }

  it("good on the last step graduates with the graduating interval", () => {
    const { note: next } = answer(onLastStep, "good", ctx(), noFuzz)
    expect(next.retentionStage).toBe("review")
    expect(next.interval).toBe(1)
    expect(next.ease).toBe(2.5)
    expect(next.step).toBe(0)
    expect(next.due).toBe(studyDayStart(NOON_JST, 1))
  })

  it("hard on a later step repeats that step", () => {
    const { note: next } = answer(onLastStep, "hard", ctx(), noFuzz)
    expect(next.retentionStage).toBe("learning")
    expect(next.step).toBe(1)
    expect(next.due - NOON_JST).toBe(10 * MINUTE)
  })

  it("again goes back to the first step", () => {
    const { note: next } = answer(onLastStep, "again", ctx(), noFuzz)
    expect(next.step).toBe(0)
    expect(next.due - NOON_JST).toBe(1 * MINUTE)
  })

  it("graduated notes become due when the next study day starts, not 24h later", () => {
    // 02:00 JST still belongs to the previous study day (rollover is 04:00).
    const twoAm = Date.UTC(2026, 9, 11, 17, 0)
    const { note: next } = answer(onLastStep, "good", ctx(twoAm), noFuzz)
    expect(next.due - twoAm).toBe(2 * HOUR)
  })
})

describe("review notes", () => {
  it("answered on time: hard x1.2, good x ease, easy x ease x easy bonus", () => {
    const note = reviewNote()
    const hard = answer(note, "hard", ctx(), noFuzz).note
    const good = answer(note, "good", ctx(), noFuzz).note
    const easy = answer(note, "easy", ctx(), noFuzz).note

    expect([hard.interval, good.interval, easy.interval]).toEqual([12, 25, 33])
    expect([hard.ease, good.ease, easy.ease]).toEqual([2.35, 2.5, 2.65])
    expect(good.due).toBe(studyDayStart(NOON_JST, 25))
  })

  it("late answers credit half the delay for good and all of it for easy", () => {
    const note = reviewNote({ due: studyDayStart(NOON_JST, -4) })
    const hard = answer(note, "hard", ctx(), noFuzz).note
    const good = answer(note, "good", ctx(), noFuzz).note
    const easy = answer(note, "easy", ctx(), noFuzz).note

    expect([hard.interval, good.interval, easy.interval]).toEqual([12, 30, 46])
  })

  it("keeps hard < good < easy even for tiny intervals and low ease", () => {
    const note = reviewNote({ interval: 1, ease: 1.3 })
    const hard = answer(note, "hard", ctx(), noFuzz).note
    const good = answer(note, "good", ctx(), noFuzz).note
    const easy = answer(note, "easy", ctx(), noFuzz).note

    expect(hard.interval).toBe(2)
    expect(good.interval).toBe(3)
    expect(easy.interval).toBe(4)
  })

  it("applies the interval modifier", () => {
    const note = reviewNote()
    const good = answer(note, "good", ctx(), { ...noFuzz, intervalModifier: 0.8 }).note
    expect(good.interval).toBe(20)
  })

  it("early reviews only credit the time actually elapsed", () => {
    const note = reviewNote({ due: studyDayStart(NOON_JST, 4) })
    const hard = answer(note, "hard", ctx(), noFuzz).note
    const good = answer(note, "good", ctx(), noFuzz).note
    const easy = answer(note, "easy", ctx(), noFuzz).note

    expect([hard.interval, good.interval, easy.interval]).toEqual([7, 15, 17])
  })

  it("never exceeds the maximum interval", () => {
    const note = reviewNote({ interval: 30_000 })
    expect(answer(note, "easy", ctx(), noFuzz).note.interval).toBe(36_500)
  })

  it("never lets ease fall below 130%", () => {
    const note = reviewNote({ ease: 1.35 })
    expect(answer(note, "again", ctx(), noFuzz).note.ease).toBe(1.3)
    expect(answer({ ...note, ease: 1.3 }, "hard", ctx(), noFuzz).note.ease).toBe(1.3)
  })
})

describe("lapses", () => {
  const note = reviewNote()

  it("again sends the note to relearning and lowers ease by 20%", () => {
    const { note: next, log } = answer(note, "again", ctx(), noFuzz)
    expect(next.retentionStage).toBe("relearning")
    expect(next.step).toBe(0)
    expect(next.lapses).toBe(1)
    expect(next.ease).toBe(2.3)
    expect(next.interval).toBe(1)
    expect(next.due - NOON_JST).toBe(10 * MINUTE)
    expect(log.leech).toBe(false)
  })

  it("the post-lapse interval honours the new-interval multiplier", () => {
    const { note: next } = answer(note, "again", ctx(), { ...noFuzz, lapseMultiplier: 0.5 })
    expect(next.interval).toBe(5)
  })

  it("good after relearning returns to review with the post-lapse interval", () => {
    const relearning = answer(note, "again", ctx(), noFuzz).note
    const later = NOON_JST + 10 * MINUTE
    const { note: next } = answer(relearning, "good", ctx(later), noFuzz)
    expect(next.retentionStage).toBe("review")
    expect(next.interval).toBe(1)
    expect(next.due).toBe(studyDayStart(later, 1))
  })

  it("easy during relearning adds a day to the post-lapse interval", () => {
    const relearning = answer(note, "again", ctx(), noFuzz).note
    expect(answer(relearning, "easy", ctx(), noFuzz).note.interval).toBe(2)
  })

  it("again during relearning does not count as another lapse", () => {
    const relearning = answer(note, "again", ctx(), noFuzz).note
    const { note: next } = answer(relearning, "again", ctx(), noFuzz)
    expect(next.lapses).toBe(1)
    expect(next.ease).toBe(2.3)
    expect(next.retentionStage).toBe("relearning")
  })

  it("lapses straight back to review when there are no relearning steps", () => {
    const { note: next } = answer(note, "again", ctx(), { ...noFuzz, relearningSteps: [] })
    expect(next.retentionStage).toBe("review")
    expect(next.due).toBe(studyDayStart(NOON_JST, 1))
  })

  it("flags leeches at the threshold and every half-threshold after", () => {
    const leechAt = (lapses: number) => answer(reviewNote({ lapses }), "again", ctx(), noFuzz).log.leech
    expect(leechAt(6)).toBe(false)
    expect(leechAt(7)).toBe(true)
    expect(leechAt(8)).toBe(false)
    expect(leechAt(11)).toBe(true)
  })
})

describe("fuzz", () => {
  const note = reviewNote()

  it("spreads review intervals within Anki's fuzz range", () => {
    const intervals = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      const next = answer(note, "good", { ...ctx(), seed }, defaultConfig).note
      intervals.add(next.interval)
      expect(next.interval).toBeGreaterThanOrEqual(22)
      expect(next.interval).toBeLessThanOrEqual(28)
    }
    expect(intervals.size).toBeGreaterThan(3)
  })

  it("is deterministic for a given note, so previews match answers", () => {
    const shown = preview(note, ctx(), defaultConfig)
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      const actual = answer(note, rating, ctx(), defaultConfig).note
      expect(shown[rating].due).toBe(actual.due)
      expect(shown[rating].interval).toBe(actual.interval)
    }
  })

  it("never fuzzes short intervals", () => {
    const short = reviewNote({ interval: 1, ease: 1.3 })
    expect(answer(short, "hard", ctx(), defaultConfig).note.interval).toBe(2)
  })

  it("adds at most 25% (capped at 5 minutes) to learning steps", () => {
    for (let seed = 0; seed < 50; seed++) {
      const next = answer(newNote(NOON_JST), "good", { ...ctx(), seed }, defaultConfig).note
      const delay = next.due - NOON_JST
      expect(delay).toBeGreaterThanOrEqual(10 * MINUTE)
      expect(delay).toBeLessThan(12.5 * MINUTE)
    }
  })
})
