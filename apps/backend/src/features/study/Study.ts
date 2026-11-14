import {
  type AddNoteRequest,
  type AnswerResult,
  type DueCounts,
  type DueNotes,
  InvalidRequest,
  type Note,
  NoteId,
  NotFound,
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
import { getEntries, notedEntries } from "../dictionary/index.ts"
import { arrange, layoutProblem } from "./arrange.ts"
import { gatherDueNotes } from "./gather.ts"
import {
  allNotes,
  arrangeNote,
  countReviewed,
  deleteNote,
  insertNote,
  learningDue,
  newNotes,
  nextLearningDue,
  nextPosition,
  noteByEntry,
  noteById,
  type NoteDeletion,
  type NoteRow,
  type NoteSchedule,
  retention,
  reviewDue,
  reviewDueTimes,
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

export class Study extends Context.Service<
  Study,
  {
    notes(user: Profile): Effect.Effect<ReadonlyArray<Note>>
    /** Saves an entry, or one of its senses, to the learner's notes; see `AddNoteRequest`. */
    addNote(user: Profile, request: AddNoteRequest): Effect.Effect<Note, NotFound | InvalidRequest>
    /** Chooses which senses a note shows, in order; null shows every sense again. */
    arrangeNote(
      user: Profile,
      id: NoteId,
      senses: ReadonlyArray<number> | null
    ): Effect.Effect<Note, NotFound | InvalidRequest>
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

      /**
       * Notes as the app reads them: each with its entry as the dictionary has it now and the
       * senses it shows. A list of them costs the same few queries as one.
       */
      const toNotes = Effect.fnUntraced(function* (rows: ReadonlyArray<NoteRow>) {
        const noted = yield* notedEntries(
          db,
          rows.map((row) => row.entryId)
        )
        return rows.flatMap((row): Array<Note> => {
          const found = noted.get(row.entryId)
          // The foreign key cascades, so a note always has its entry; one deleted mid-read is left out.
          if (found === undefined) return []
          return [
            {
              id: row.id,
              createdAt: row.createdAt,
              entry: found.entry,
              ...arrange(found.senses, row.senses),
              retentionStage: row.retentionStage,
              due: row.due,
              interval: row.interval,
              ease: row.ease,
              reps: row.reps,
              lapses: row.lapses,
              leech: row.leech
            }
          ]
        })
      })
      const toNote = (row: NoteRow) =>
        toNotes([row]).pipe(
          Effect.flatMap((notes) =>
            notes[0] === undefined ? Effect.die(new Error(`Note ${row.id} has no entry`)) : Effect.succeed(notes[0])
          )
        )

      const notes = Effect.fn("Study.notes")(function* (user: Profile) {
        return yield* toNotes(yield* allNotes(learnerOf(user)))
      })

      const addNote = Effect.fn("Study.addNote")(function* (user: Profile, request: AddNoteRequest) {
        const learner = learnerOf(user)
        const [entry] = yield* getEntries(db, [request.entryId])
        if (entry === undefined) return yield* new NotFound({ message: "No such entry" })
        if (request.sense !== undefined && layoutProblem([request.sense], entry.senses.length) !== null) {
          return yield* new InvalidRequest({ message: "That entry has no such sense" })
        }

        const existing = yield* noteByEntry(learner, entry.id)
        if (Option.isSome(existing)) {
          // Saving a sense the note hides shows it too, after the others; saving again changes nothing.
          const layout = existing.value.senses
          if (request.sense === undefined || layout === null || layout.includes(request.sense)) {
            return yield* toNote(existing.value)
          }
          const arranged = yield* arrangeNote(learner, existing.value.id, [...layout, request.sense])
          return yield* toNote(Option.getOrElse(arranged, () => existing.value))
        }

        // A discarded draft stays in the notes of whoever saved it, but no one saves it anew.
        if (entry.review === "discarded")
          return yield* new InvalidRequest({ message: "That entry isn't in the dictionary" })
        const now = new Date(yield* Clock.currentTimeMillis)
        const saved = yield* insertNote(learner, {
          id: NoteId.make(randomUUID()),
          entryId: entry.id,
          senses: request.sense === undefined ? null : [request.sense],
          retentionStage: "new",
          due: now,
          seed: randomInt(2 ** 31),
          position: yield* nextPosition(learner),
          createdAt: now
        })
        return yield* toNote(saved)
      })

      const arrange_ = Effect.fn("Study.arrangeNote")(function* (
        user: Profile,
        id: NoteId,
        senses: ReadonlyArray<number> | null
      ) {
        const learner = learnerOf(user)
        const found = yield* noteById(learner, id)
        if (Option.isNone(found)) return yield* new NotFound({ message: "No such note" })
        if (senses !== null) {
          const [entry] = yield* getEntries(db, [found.value.entryId])
          const problem = layoutProblem(senses, entry?.senses.length ?? 0)
          if (problem !== null) return yield* new InvalidRequest({ message: problem })
        }
        const arranged = yield* arrangeNote(learner, id, senses)
        if (Option.isNone(arranged)) return yield* new NotFound({ message: "No such note" })
        return yield* toNote(arranged.value)
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

        const page = ordered.slice(0, limit)
        const shown = new Map((yield* toNotes(page)).map((note) => [note.id, note]))
        const items = page.flatMap((note) => {
          const view = shown.get(note.id)
          return view === undefined
            ? []
            : [{ note: view, labels: labelsFor(note, { now, ...clockFor(user, now), seed: note.seed }) }]
        })
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
        return Option.some({ note: yield* toNote({ ...note, ...schedule }), leech: outcome.log.leech })
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

      return Study.of({ notes, addNote, arrangeNote: arrange_, removeNote, dueNotes, answer, stats })
    })
  )
}
