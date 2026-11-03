import {
  type AddNoteRequest,
  type AnswerLabels,
  type AnswerResult,
  type CardId,
  type CardSummary,
  type Note,
  NoteId,
  type Profile,
  type QueueCounts,
  type Rating,
  type ReviewQueue,
  type StudyCard,
  type StudyStats
} from "@kotori/contracts"
import {
  answer as answerCard,
  type CardState,
  dayNumber,
  dayStart,
  defaultConfig,
  formatPreview,
  preview,
  type ReviewContext
} from "@kotori/srs"
import { Clock, Context, Effect, Layer, Option } from "effect"
import { randomInt, randomUUID } from "node:crypto"
import { Database } from "../../db/Database.ts"
import { type Learner, scopedToUser } from "../../db/scopedToUser.ts"
import { gatherQueue } from "./gather.ts"
import {
  answerCard as saveAnswer,
  type CardRow,
  type CardWithContent,
  cardWithContent,
  countAnswers,
  deleteNote,
  insertNote,
  learningDue,
  newCards,
  nextLearningDue,
  nextPosition,
  noteCount,
  type NoteRow,
  type NoteDeletion,
  notesWithCards,
  noteWithCards,
  queueCounts,
  retention,
  reviewDue,
  reviewDueTimes,
  savedWords,
  studyDays
} from "./queries.ts"
import { utcOffsetMinutes } from "./time.ts"

/** Learning cards due within this window can be shown early, as in Anki. */
const LEARN_AHEAD = 20 * 60_000

/** The scheduler's view of a card: it works in epoch milliseconds. */
const toState = (card: CardRow): CardState => ({
  queue: card.queue,
  due: card.due.getTime(),
  interval: card.interval,
  ease: card.ease,
  step: card.step,
  reps: card.reps,
  lapses: card.lapses,
  lastReview: card.lastReview?.getTime() ?? null
})

const toStudyCard = (card: CardWithContent): StudyCard => ({
  id: card.id,
  noteId: card.noteId,
  template: card.template,
  queue: card.queue,
  due: card.due,
  interval: card.interval,
  ease: card.ease,
  reps: card.reps,
  lapses: card.lapses,
  leech: card.leech,
  content: card.content
})

const toSummary = (card: CardRow): CardSummary => ({
  id: card.id,
  template: card.template,
  queue: card.queue,
  due: card.due,
  interval: card.interval,
  leech: card.leech
})

const toNote = (note: NoteRow, cards: ReadonlyArray<CardRow>): Note => ({
  id: note.id,
  content: note.content,
  createdAt: note.createdAt,
  cards: cards.map(toSummary)
})

export class Study extends Context.Service<
  Study,
  {
    notes(user: Profile): Effect.Effect<ReadonlyArray<Note>>
    addNote(user: Profile, request: AddNoteRequest): Effect.Effect<Note>
    removeNote(user: Profile, id: NoteId): Effect.Effect<NoteDeletion>
    queue(user: Profile, limit: number): Effect.Effect<ReviewQueue>
    answer(
      user: Profile,
      id: CardId,
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

      const clockFor = (user: Profile, now: number) => ({ utcOffsetMinutes: utcOffsetMinutes(user.timezone, now) })

      const notes = Effect.fn("Study.notes")(function* (user: Profile) {
        return (yield* notesWithCards(learnerOf(user))).map(({ cards, ...note }) => toNote(note, cards))
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
            const found = yield* noteWithCards(learner, existing.id)
            if (Option.isSome(found)) {
              const { cards, ...note } = found.value
              return toNote(note, cards)
            }
          }
        }

        const now = new Date(yield* Clock.currentTimeMillis)
        // One card per saved item: the target-language side.
        const saved = yield* insertNote(
          learner,
          {
            id: NoteId.make(randomUUID()),
            kind: content.kind,
            content,
            entryId: word?.entryId ?? null,
            sense: word?.senseIndex ?? null,
            createdAt: now
          },
          [
            {
              template: "recognize",
              queue: "new",
              due: now,
              seed: randomInt(2 ** 31),
              position: yield* nextPosition(learner),
              createdAt: now
            }
          ]
        )
        return toNote(saved.note, saved.cards)
      })

      const removeNote = (user: Profile, id: NoteId) => deleteNote(learnerOf(user), id)

      const labelsFor = (card: CardRow, ctx: ReviewContext): AnswerLabels => {
        const shown = preview(toState(card), ctx, defaultConfig)
        return {
          again: formatPreview(shown.again, ctx.now),
          hard: formatPreview(shown.hard, ctx.now),
          good: formatPreview(shown.good, ctx.now),
          easy: formatPreview(shown.easy, ctx.now)
        }
      }

      const counts = Effect.fnUntraced(function* (user: Profile, now: number) {
        const learner = learnerOf(user)
        const today = dayNumber(now, clockFor(user, now))
        const learning = yield* learningDue(learner, new Date(now + LEARN_AHEAD))
        const reviewedToday = yield* countAnswers(learner, today, "review")
        const reviews = yield* reviewDue(learner, new Date(now), Math.max(user.dailyReviewLimit - reviewedToday, 0))
        const introducedToday = yield* countAnswers(learner, today, "new")
        const fresh = yield* newCards(learner, Math.max(user.dailyNewLimit - introducedToday, 0))
        return { learning, reviews, fresh }
      })

      const queue = Effect.fn("Study.queue")(function* (user: Profile, limit: number) {
        const now = yield* Clock.currentTimeMillis
        const { learning, reviews, fresh } = yield* counts(user, now)
        const ordered = gatherQueue(learning, reviews, fresh, new Date(now))

        const items = ordered.slice(0, limit).map((card) => ({
          card: toStudyCard(card),
          labels: labelsFor(card, { now, ...clockFor(user, now), seed: card.seed })
        }))
        const queueCounts: QueueCounts = { new: fresh.length, learning: learning.length, review: reviews.length }
        const nextDue = items.length === 0 ? Option.getOrNull(yield* nextLearningDue(learnerOf(user))) : null
        const dueCards = ordered.map(({ noteId, queue }) => ({ noteId, queue }))
        return { items, counts: queueCounts, dueCards, nextDue }
      })

      const answer = Effect.fn("Study.answer")(function* (
        user: Profile,
        id: CardId,
        rating: Rating,
        durationMs: number | undefined
      ) {
        const learner = learnerOf(user)
        const found = yield* cardWithContent(learner, id)
        if (Option.isNone(found)) return Option.none()
        const card = found.value
        const now = yield* Clock.currentTimeMillis
        const ctx: ReviewContext = { now, ...clockFor(user, now), seed: card.seed }
        const outcome = answerCard(toState(card), rating, ctx, defaultConfig)

        const updated: CardWithContent = {
          ...card,
          ...outcome.card,
          due: new Date(outcome.card.due),
          lastReview: outcome.card.lastReview === null ? null : new Date(outcome.card.lastReview),
          leech: card.leech || outcome.log.leech
        }
        yield* saveAnswer(
          learner,
          card.id,
          {
            queue: updated.queue,
            due: updated.due,
            interval: updated.interval,
            ease: updated.ease,
            step: updated.step,
            reps: updated.reps,
            lapses: updated.lapses,
            leech: updated.leech,
            lastReview: updated.lastReview
          },
          {
            rating,
            queueBefore: outcome.log.queueBefore,
            intervalBefore: outcome.log.intervalBefore,
            interval: outcome.log.interval,
            easeBefore: outcome.log.easeBefore,
            ease: outcome.log.ease,
            delayMs: outcome.log.delay,
            durationMs: durationMs ?? null,
            reviewedAt: new Date(now),
            studyDay: dayNumber(now, ctx)
          }
        )
        return Option.some({ card: toStudyCard(updated), leech: outcome.log.leech })
      })

      const stats = Effect.fn("Study.stats")(function* (user: Profile) {
        const learner = learnerOf(user)
        const now = yield* Clock.currentTimeMillis
        const clock = clockFor(user, now)
        const today = dayNumber(now, clock)
        const { learning, reviews, fresh } = yield* counts(user, now)

        const days = yield* studyDays(learner)
        let streak = 0
        let expected = days[0] === today ? today : today - 1
        for (const day of days) {
          if (day !== expected) break
          streak++
          expected--
        }

        const byQueue = yield* queueCounts(learner)
        const total = (filter: (row: (typeof byQueue)[number]) => boolean) =>
          byQueue.filter(filter).reduce((sum, row) => sum + row.n, 0)

        const answered = yield* retention(learner, today - 30)
        const dueTimes = yield* reviewDueTimes(learner, new Date(dayStart(today + 7, clock)))
        const forecast = Array.from(
          { length: 7 },
          (_, offset) =>
            dueTimes.filter((due) => Math.max(dayNumber(due.getTime(), clock), today) === today + offset).length
        )

        return {
          due: { new: fresh.length, learning: learning.length, review: reviews.length },
          reviewedToday: yield* countAnswers(learner, today),
          streak,
          notes: yield* noteCount(learner),
          cards: total(() => true),
          unseen: total((row) => row.queue === "new"),
          young: total((row) => row.queue !== "new" && !(row.queue === "review" && row.mature)),
          mature: total((row) => row.queue === "review" && row.mature),
          retention: answered.total === 0 ? null : 1 - answered.failed / answered.total,
          forecast
        }
      })

      return Study.of({ notes, addNote, removeNote, queue, answer, stats })
    })
  )
}
