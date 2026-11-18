import {
  type AddNoteRequest,
  type AnswerResult,
  type DueCounts,
  type DueNotes,
  type Note,
  NoteId,
  type Profile,
  type Rating,
  type RatingLabels,
  type StudyStats
} from "@kotori/contracts"
import {
  answer as answerNote,
  dayNumber,
  dayStart,
  defaultConfig,
  formatPreview,
  type NoteState,
  preview,
  type ReviewContext
} from "@kotori/srs"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { randomInt, randomUUID } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { type Learner, scopedToUser } from "../../db/scopedToUser.ts"
import { gatherDueNotes } from "./gather.ts"
import {
  allNotes,
  countReviewed,
  deleteNote,
  insertNote,
  learningDue,
  newNotes,
  nextLearningDue,
  nextPosition,
  noteById,
  type NoteDeletion,
  type NoteRow,
  type NoteSchedule,
  retention,
  reviewDue,
  reviewDueTimes,
  savedWords,
  saveReview,
  stageCounts,
  studyDays
} from "./queries.ts"
import { utcOffsetMinutes } from "./time.ts"

/** Learning notes due within this window can be shown early, as in Anki. */
const LEARN_AHEAD = 20 * 60_000

/** The scheduler's view of a note: it works in epoch milliseconds. */
const toState = (note: NoteRow): NoteState => ({
  retentionStage: note.retentionStage,
  due: note.due.getTime(),
  interval: note.interval,
  ease: note.ease,
  step: note.step,
  reps: note.reps,
  lapses: note.lapses,
  lastReview: note.lastReview?.getTime() ?? null
})

const toNote = (note: NoteRow): Note => ({
  id: note.id,
  content: note.content,
  createdAt: note.createdAt,
  retentionStage: note.retentionStage,
  due: note.due,
  interval: note.interval,
  ease: note.ease,
  reps: note.reps,
  lapses: note.lapses,
  leech: note.leech
})

export class Study extends Context.Service<
  Study,
  {
    notes(user: Profile): Effect.Effect<ReadonlyArray<Note>>
    addNote(user: Profile, request: AddNoteRequest): Effect.Effect<Note>
    removeNote(user: Profile, id: NoteId): Effect.Effect<NoteDeletion>
    dueNotes(user: Profile, limit: number): Effect.Effect<DueNotes>
    answer(
      user: Profile,
      id: NoteId,
      rating: Rating,
      durationMs: number | undefined
    ): Effect.Effect<Option.Option<AnswerResult>>
    stats(user: Profile): Effect.Effect<StudyStats>
  }
>()("@kotori/backend/Study") {
  static readonly layer = Layer.effect(
    Study,
    Effect.gen(function* () {
      const db = yield* Database
      const learnerOf = (user: Profile): Learner => scopedToUser(db, user.id)

      const clockFor = (user: Profile, now: number) => ({
        utcOffsetMinutes: utcOffsetMinutes(user.timezone, now)
      })

      const notes = Effect.fn("Study.notes")(function* (user: Profile) {
        return (yield* allNotes(learnerOf(user))).map(toNote)
      })

      const addNote = Effect.fn("Study.addNote")(function* (user: Profile, request: AddNoteRequest) {
        const learner = learnerOf(user)
        const content = request.content
        const word = content.kind === "word" ? content : undefined
        if (word !== undefined) {
          // Saving the same sense twice returns the existing note.
          const saved = yield* savedWords(learner, [word.entryId])
          const existing = saved.find((row) => row.sense === word.senseIndex)
          if (existing !== undefined) {
            const found = yield* noteById(learner, existing.id)
            if (Option.isSome(found)) return toNote(found.value)
          }
        }

        const now = new Date(yield* Clock.currentTimeMillis)
        const saved = yield* insertNote(learner, {
          id: NoteId.make(randomUUID()),
          kind: content.kind,
          content,
          entryId: word?.entryId ?? null,
          sense: word?.senseIndex ?? null,
          retentionStage: "new",
          due: now,
          seed: randomInt(2 ** 31),
          position: yield* nextPosition(learner),
          createdAt: now
        })
        return toNote(saved)
      })

      const removeNote = (user: Profile, id: NoteId) => deleteNote(learnerOf(user), id)

      const labelsFor = (note: NoteRow, ctx: ReviewContext): RatingLabels => {
        const shown = preview(toState(note), ctx, defaultConfig)
        return {
          again: formatPreview(shown.again, ctx.now),
          hard: formatPreview(shown.hard, ctx.now),
          good: formatPreview(shown.good, ctx.now),
          easy: formatPreview(shown.easy, ctx.now)
        }
      }

      /** The notes due now, by retention stage, within the learner's daily limits. */
      const due = Effect.fnUntraced(function* (user: Profile, now: number) {
        const learner = learnerOf(user)
        const today = dayNumber(now, clockFor(user, now))
        const learning = yield* learningDue(learner, new Date(now + LEARN_AHEAD))
        const reviewedToday = yield* countReviewed(learner, today, "review")
        const reviews = yield* reviewDue(learner, new Date(now), Math.max(user.dailyReviewLimit - reviewedToday, 0))
        const introducedToday = yield* countReviewed(learner, today, "new")
        const fresh = yield* newNotes(learner, Math.max(user.dailyNewLimit - introducedToday, 0))
        return { learning, reviews, fresh }
      })

      const dueNotes = Effect.fn("Study.dueNotes")(function* (user: Profile, limit: number) {
        const now = yield* Clock.currentTimeMillis
        const { learning, reviews, fresh } = yield* due(user, now)
        const ordered = gatherDueNotes(learning, reviews, fresh, new Date(now))

        const items = ordered.slice(0, limit).map((note) => ({
          note: toNote(note),
          labels: labelsFor(note, { now, ...clockFor(user, now), seed: note.seed })
        }))
        const counts: DueCounts = { new: fresh.length, learning: learning.length, review: reviews.length }
        const nextDue = items.length === 0 ? Option.getOrNull(yield* nextLearningDue(learnerOf(user))) : null
        const all = ordered.map(({ id, retentionStage }) => ({ id, retentionStage }))
        return { items, counts, all, nextDue }
      })

      const answer = Effect.fn("Study.answer")(function* (
        user: Profile,
        id: NoteId,
        rating: Rating,
        durationMs: number | undefined
      ) {
        const learner = learnerOf(user)
        const found = yield* noteById(learner, id)
        if (Option.isNone(found)) return Option.none()
        const note = found.value
        const now = yield* Clock.currentTimeMillis
        const ctx: ReviewContext = { now, ...clockFor(user, now), seed: note.seed }
        const outcome = answerNote(toState(note), rating, ctx, defaultConfig)

        const schedule: NoteSchedule = {
          retentionStage: outcome.note.retentionStage,
          due: new Date(outcome.note.due),
          interval: outcome.note.interval,
          ease: outcome.note.ease,
          step: outcome.note.step,
          reps: outcome.note.reps,
          lapses: outcome.note.lapses,
          leech: note.leech || outcome.log.leech,
          lastReview: outcome.note.lastReview === null ? null : new Date(outcome.note.lastReview)
        }
        yield* saveReview(learner, note.id, schedule, {
          rating,
          retentionStageBefore: outcome.log.retentionStageBefore,
          intervalBefore: outcome.log.intervalBefore,
          interval: outcome.log.interval,
          easeBefore: outcome.log.easeBefore,
          ease: outcome.log.ease,
          delayMs: outcome.log.delay,
          durationMs: durationMs ?? null,
          reviewedAt: new Date(now),
          studyDay: dayNumber(now, ctx)
        })
        return Option.some({ note: toNote({ ...note, ...schedule }), leech: outcome.log.leech })
      })

      const stats = Effect.fn("Study.stats")(function* (user: Profile) {
        const learner = learnerOf(user)
        const now = yield* Clock.currentTimeMillis
        const clock = clockFor(user, now)
        const today = dayNumber(now, clock)
        const { learning, reviews, fresh } = yield* due(user, now)

        const days = yield* studyDays(learner)
        let streak = 0
        let expected = days[0] === today ? today : today - 1
        for (const day of days) {
          if (day !== expected) break
          streak++
          expected--
        }

        const byStage = yield* stageCounts(learner)
        const total = (filter: (row: (typeof byStage)[number]) => boolean) =>
          byStage.filter(filter).reduce((sum, row) => sum + row.n, 0)

        const answered = yield* retention(learner, today - 30)
        const dueTimes = yield* reviewDueTimes(learner, new Date(dayStart(today + 7, clock)))
        const forecast = Array.from(
          { length: 7 },
          (_, offset) =>
            dueTimes.filter((due) => Math.max(dayNumber(due.getTime(), clock), today) === today + offset).length
        )

        return {
          due: { new: fresh.length, learning: learning.length, review: reviews.length },
          reviewedToday: yield* countReviewed(learner, today),
          streak,
          notes: total(() => true),
          unseen: total((row) => row.retentionStage === "new"),
          young: total((row) => row.retentionStage !== "new" && !(row.retentionStage === "review" && row.mature)),
          mature: total((row) => row.retentionStage === "review" && row.mature),
          retention: answered.total === 0 ? null : 1 - answered.failed / answered.total,
          forecast
        }
      })

      return Study.of({ notes, addNote, removeNote, dueNotes, answer, stats })
    })
  )
}
