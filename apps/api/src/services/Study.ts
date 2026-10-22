import { type CardRow, type CardWithContent, type NoteRow, StudyRepo } from "@kotori/db"
import {
  type AddNoteRequest,
  type AnswerLabels,
  type AnswerResult,
  CardId,
  type CardSummary,
  type CardTemplate,
  type Note,
  NoteId,
  type Profile,
  type QueueCounts,
  type Rating,
  type ReviewQueue,
  type StudyCard,
  type StudyStats
} from "@kotori/domain"
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
import { utcOffsetMinutes } from "./time.ts"

/** Learning cards due within this window can be shown early, as in Anki. */
const LEARN_AHEAD = 20 * 60_000
const toState = (card: CardRow): CardState => ({
  queue: card.queue,
  due: card.due,
  interval: card.interval,
  ease: card.ease,
  step: card.step,
  reps: card.reps,
  lapses: card.lapses,
  lastReview: card.lastReview
})

const toStudyCard = (card: CardWithContent): StudyCard => ({
  id: CardId.make(card.id),
  noteId: NoteId.make(card.noteId),
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
  id: CardId.make(card.id),
  template: card.template,
  queue: card.queue,
  due: card.due,
  interval: card.interval,
  leech: card.leech
})

const toNote = (note: NoteRow, cards: ReadonlyArray<CardRow>): Note => ({
  id: NoteId.make(note.id),
  content: note.content,
  createdAt: note.createdAt,
  cards: cards.map(toSummary)
})

export class Study extends Context.Service<
  Study,
  {
    notes(user: Profile): Effect.Effect<ReadonlyArray<Note>>
    addNote(user: Profile, request: AddNoteRequest): Effect.Effect<Note>
    removeNote(user: Profile, id: NoteId): Effect.Effect<boolean>
    queue(user: Profile, limit: number): Effect.Effect<ReviewQueue>
    answer(
      user: Profile,
      id: CardId,
      rating: Rating,
      durationMs: number | undefined
    ): Effect.Effect<Option.Option<AnswerResult>>
    stats(user: Profile): Effect.Effect<StudyStats>
  }
>()("@kotori/api/Study") {
  static readonly layer = Layer.effect(
    Study,
    Effect.gen(function* () {
      const repo = yield* StudyRepo

      const clockFor = (user: Profile, now: number) => ({ utcOffsetMinutes: utcOffsetMinutes(user.timezone, now) })

      const notes = Effect.fn("Study.notes")(function* (user: Profile) {
        return (yield* repo.notes(user.id)).map(({ note, cards }) => toNote(note, cards))
      })

      const addNote = Effect.fn("Study.addNote")(function* (user: Profile, request: AddNoteRequest) {
        const content = request.content
        const word = content.kind === "word" ? content : undefined
        if (word !== undefined) {
          // Saving the same sense twice returns the existing note.
          const saved = yield* repo.savedWords(user.id, [word.entryId])
          const existing = saved.find((row) => row.sense === word.senseIndex)
          if (existing !== undefined) {
            const found = yield* repo.note(user.id, existing.id)
            if (Option.isSome(found)) return toNote(found.value.note, found.value.cards)
          }
        }

        const now = yield* Clock.currentTimeMillis
        const templates: ReadonlyArray<CardTemplate> =
          request.templates && request.templates.length > 0 ? [...new Set(request.templates)] : ["recognize", "produce"]
        const position = yield* repo.nextPosition(user.id)
        const note: NoteRow = {
          id: randomUUID(),
          userId: user.id,
          content,
          entryId: word?.entryId ?? null,
          sense: word?.senseIndex ?? null,
          createdAt: now
        }
        const cards = templates.map((template): CardRow => ({
          id: randomUUID(),
          noteId: note.id,
          userId: user.id,
          template,
          queue: "new",
          due: now,
          interval: 0,
          ease: 0,
          step: 0,
          reps: 0,
          lapses: 0,
          leech: false,
          lastReview: null,
          seed: randomInt(2 ** 31),
          position,
          createdAt: now
        }))
        yield* repo.insertNote(note, cards)
        return toNote(note, cards)
      })

      const removeNote = (user: Profile, id: NoteId) => repo.deleteNote(user.id, id)

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
        const clock = clockFor(user, now)
        const today = dayNumber(now, clock)
        const learning = yield* repo.learningDue(user.id, now + LEARN_AHEAD)
        const reviewedToday = yield* repo.countAnswers(user.id, today, "review")
        const reviews = yield* repo.reviewDue(user.id, now, Math.max(user.dailyReviewLimit - reviewedToday, 0))
        const introducedToday = yield* repo.countAnswers(user.id, today, "new")
        const fresh = yield* repo.newCards(user.id, Math.max(user.dailyNewLimit - introducedToday, 0))
        return { learning, reviews, fresh }
      })

      const queue = Effect.fn("Study.queue")(function* (user: Profile, limit: number) {
        const now = yield* Clock.currentTimeMillis
        const { learning, reviews, fresh } = yield* counts(user, now)
        // Learning cards that are due come first (they're time-sensitive), then reviews with new cards
        // spread among them. Learning cards not quite due yet only come up when nothing else is left,
        // as with Anki's learn-ahead limit.
        const ordered: Array<CardWithContent> = learning.filter((card) => card.due <= now)
        const spacing = fresh.length === 0 ? Infinity : Math.max(Math.floor(reviews.length / fresh.length), 1)
        let next = 0
        reviews.forEach((card, index) => {
          ordered.push(card)
          if ((index + 1) % spacing === 0 && next < fresh.length) ordered.push(fresh[next++]!)
        })
        ordered.push(...fresh.slice(next))
        ordered.push(...learning.filter((card) => card.due > now))

        const items = ordered.slice(0, limit).map((card) => ({
          card: toStudyCard(card),
          labels: labelsFor(card, { now, ...clockFor(user, now), seed: card.seed })
        }))
        const queueCounts: QueueCounts = { new: fresh.length, learning: learning.length, review: reviews.length }
        const nextDue = items.length === 0 ? Option.getOrNull(yield* repo.nextLearningDue(user.id)) : null
        return { items, counts: queueCounts, nextDue }
      })

      const answer = Effect.fn("Study.answer")(function* (
        user: Profile,
        id: CardId,
        rating: Rating,
        durationMs: number | undefined
      ) {
        const found = yield* repo.card(user.id, id)
        if (Option.isNone(found)) return Option.none()
        const card = found.value
        const now = yield* Clock.currentTimeMillis
        const ctx: ReviewContext = { now, ...clockFor(user, now), seed: card.seed }
        const outcome = answerCard(toState(card), rating, ctx, defaultConfig)

        const updated: CardWithContent = { ...card, ...outcome.card, leech: card.leech || outcome.log.leech }
        yield* repo.updateCard(updated)
        yield* repo.insertLog({
          cardId: card.id,
          userId: user.id,
          rating,
          queueBefore: outcome.log.queueBefore,
          intervalBefore: outcome.log.intervalBefore,
          interval: outcome.log.interval,
          easeBefore: outcome.log.easeBefore,
          ease: outcome.log.ease,
          delay: outcome.log.delay,
          durationMs: durationMs ?? null,
          reviewedAt: now,
          studyDay: dayNumber(now, ctx)
        })
        return Option.some({ card: toStudyCard(updated), leech: outcome.log.leech })
      })

      const stats = Effect.fn("Study.stats")(function* (user: Profile) {
        const now = yield* Clock.currentTimeMillis
        const clock = clockFor(user, now)
        const today = dayNumber(now, clock)
        const { learning, reviews, fresh } = yield* counts(user, now)

        const days = yield* repo.studyDays(user.id)
        let streak = 0
        let expected = days[0] === today ? today : today - 1
        for (const day of days) {
          if (day !== expected) break
          streak++
          expected--
        }

        const byQueue = yield* repo.queueCounts(user.id)
        const total = (filter: (row: (typeof byQueue)[number]) => boolean) =>
          byQueue.filter(filter).reduce((sum, row) => sum + row.n, 0)

        const retention = yield* repo.retention(user.id, today - 30)
        const dueTimes = yield* repo.reviewDueTimes(user.id, dayStart(today + 7, clock))
        const forecast = Array.from(
          { length: 7 },
          (_, offset) => dueTimes.filter((due) => Math.max(dayNumber(due, clock), today) === today + offset).length
        )

        return {
          due: { new: fresh.length, learning: learning.length, review: reviews.length },
          reviewedToday: yield* repo.countAnswers(user.id, today),
          streak,
          notes: yield* repo.noteCount(user.id),
          cards: total(() => true),
          unseen: total((row) => row.queue === "new"),
          young: total((row) => row.queue !== "new" && !(row.queue === "review" && row.mature)),
          mature: total((row) => row.queue === "review" && row.mature),
          retention: retention.total === 0 ? null : 1 - retention.failed / retention.total,
          forecast
        }
      })

      return Study.of({ notes, addNote, removeNote, queue, answer, stats })
    })
  )
}
