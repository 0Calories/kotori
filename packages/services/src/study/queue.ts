import { at, atOrNull, Database, millis, millisOrNull } from "@kotori/db"
import { cards, notes, reviewLogs } from "@kotori/db/schema"
import {
  type AnswerLabels,
  type AnswerResult,
  CardId,
  type CardQueue,
  NoteId,
  type Profile,
  type QueueCounts,
  type Rating,
  type ReviewQueue,
  type StudyCard
} from "@kotori/domain"
import {
  answer as answerCard,
  type CardState,
  dayNumber,
  defaultConfig,
  formatPreview,
  preview,
  type ReviewContext
} from "@kotori/srs"
import { and, asc, countDistinct, eq, getTableColumns, inArray, lte, min } from "drizzle-orm"
import { Clock, Effect, Option } from "effect"
import { utcOffsetMinutes } from "../time.ts"

/** Learning cards due within this window can be shown early, as in Anki. */
const LEARN_AHEAD = 20 * 60_000

type Card = typeof cards.$inferSelect
type CardWithContent = Card & { readonly content: typeof notes.$inferSelect.content }

/** The learner's local day for the SRS: study days roll over at 4am in their time zone. */
export const clockFor = (user: Profile, now: number) => ({ utcOffsetMinutes: utcOffsetMinutes(user.timezone, now) })

const toState = (card: Card): CardState => ({
  queue: card.queue,
  due: millis(card.due),
  interval: card.interval,
  ease: card.ease,
  step: card.step,
  reps: card.reps,
  lapses: card.lapses,
  lastReview: millisOrNull(card.lastReview)
})

const toStudyCard = (card: CardWithContent): StudyCard => ({
  id: CardId.make(card.id),
  noteId: NoteId.make(card.noteId),
  template: card.template,
  queue: card.queue,
  due: millis(card.due),
  interval: card.interval,
  ease: card.ease,
  reps: card.reps,
  lapses: card.lapses,
  leech: card.leech,
  content: card.content
})

const cardsWithContent = { ...getTableColumns(cards), content: notes.content }

const selectCards = Effect.map(Database, (db) =>
  db.select(cardsWithContent).from(cards).innerJoin(notes, eq(notes.id, cards.noteId))
)

const learningDue = Effect.fn("study.learningDue")(function* (userId: string, until: number) {
  return yield* (yield* selectCards)
    .where(and(eq(cards.userId, userId), inArray(cards.queue, ["learning", "relearning"]), lte(cards.due, at(until))))
    .orderBy(asc(cards.due))
}, Effect.orDie)

const reviewDue = Effect.fn("study.reviewDue")(function* (userId: string, until: number, limit: number) {
  if (limit <= 0) return []
  return yield* (yield* selectCards)
    .where(and(eq(cards.userId, userId), eq(cards.queue, "review"), lte(cards.due, at(until))))
    .orderBy(asc(cards.due), asc(cards.seed))
    .limit(limit)
}, Effect.orDie)

const newCards = Effect.fn("study.newCards")(function* (userId: string, limit: number) {
  if (limit <= 0) return []
  return yield* (yield* selectCards)
    .where(and(eq(cards.userId, userId), eq(cards.queue, "new")))
    .orderBy(asc(cards.position), asc(cards.template))
    .limit(limit)
}, Effect.orDie)

/** Cards answered on a study day; `queueBefore` narrows to e.g. newly introduced cards. */
export const countAnswers = Effect.fn("study.countAnswers")(function* (
  userId: string,
  studyDay: number,
  queueBefore?: CardQueue
) {
  const db = yield* Database
  const rows = yield* db
    .select({ n: countDistinct(reviewLogs.cardId) })
    .from(reviewLogs)
    .where(
      and(
        eq(reviewLogs.userId, userId),
        eq(reviewLogs.studyDay, studyDay),
        queueBefore === undefined ? undefined : eq(reviewLogs.queueBefore, queueBefore)
      )
    )
  return rows[0]?.n ?? 0
}, Effect.orDie)

/** What's due now within the learner's daily limits: learning cards, reviews and new cards. */
export const due = Effect.fnUntraced(function* (user: Profile, now: number) {
  const today = dayNumber(now, clockFor(user, now))
  const learning = yield* learningDue(user.id, now + LEARN_AHEAD)
  const reviewedToday = yield* countAnswers(user.id, today, "review")
  const reviews = yield* reviewDue(user.id, now, Math.max(user.dailyReviewLimit - reviewedToday, 0))
  const introducedToday = yield* countAnswers(user.id, today, "new")
  const fresh = yield* newCards(user.id, Math.max(user.dailyNewLimit - introducedToday, 0))
  return { learning, reviews, fresh }
})

const nextLearningDue = Effect.fn("study.nextLearningDue")(function* (userId: string) {
  const db = yield* Database
  const rows = yield* db
    .select({ due: min(cards.due) })
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.queue, ["learning", "relearning"])))
  return Option.fromNullishOr(rows[0]?.due).pipe(Option.map(millis))
}, Effect.orDie)

const labelsFor = (card: Card, ctx: ReviewContext): AnswerLabels => {
  const shown = preview(toState(card), ctx, defaultConfig)
  return {
    again: formatPreview(shown.again, ctx.now),
    hard: formatPreview(shown.hard, ctx.now),
    good: formatPreview(shown.good, ctx.now),
    easy: formatPreview(shown.easy, ctx.now)
  }
}

/** The cards to review next, in order, with what each answer would schedule. */
export const queue = Effect.fn("study.queue")(function* (user: Profile, limit: number) {
  const now = yield* Clock.currentTimeMillis
  const { learning, reviews, fresh } = yield* due(user, now)
  // Learning cards that are due come first (they're time-sensitive), then reviews with new cards
  // spread among them. Learning cards not quite due yet only come up when nothing else is left,
  // as with Anki's learn-ahead limit.
  const ordered: Array<CardWithContent> = learning.filter((card) => millis(card.due) <= now)
  const spacing = fresh.length === 0 ? Infinity : Math.max(Math.floor(reviews.length / fresh.length), 1)
  let next = 0
  reviews.forEach((card, index) => {
    ordered.push(card)
    if ((index + 1) % spacing === 0 && next < fresh.length) ordered.push(fresh[next++]!)
  })
  ordered.push(...fresh.slice(next))
  ordered.push(...learning.filter((card) => millis(card.due) > now))

  const items = ordered.slice(0, limit).map((card) => ({
    card: toStudyCard(card),
    labels: labelsFor(card, { now, ...clockFor(user, now), seed: card.seed })
  }))
  const counts: QueueCounts = { new: fresh.length, learning: learning.length, review: reviews.length }
  const nextDue = items.length === 0 ? Option.getOrNull(yield* nextLearningDue(user.id)) : null
  return { items, counts, nextDue } satisfies ReviewQueue
})

/** Schedules a card by the learner's answer and logs it; none if the learner has no such card. */
export const answer = Effect.fn("study.answer")(function* (
  user: Profile,
  id: CardId,
  rating: Rating,
  durationMs: number | undefined
) {
  const db = yield* Database
  const [card] = yield* (yield* selectCards).where(and(eq(cards.userId, user.id), eq(cards.id, id))).pipe(Effect.orDie)
  if (card === undefined) return Option.none<AnswerResult>()
  const now = yield* Clock.currentTimeMillis
  const ctx: ReviewContext = { now, ...clockFor(user, now), seed: card.seed }
  const { card: next, log } = answerCard(toState(card), rating, ctx, defaultConfig)

  const scheduled = {
    queue: next.queue,
    due: at(next.due),
    interval: next.interval,
    ease: next.ease,
    step: next.step,
    reps: next.reps,
    lapses: next.lapses,
    lastReview: atOrNull(next.lastReview),
    leech: card.leech || log.leech
  }
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.update(cards).set(scheduled).where(eq(cards.id, card.id))
        yield* tx.insert(reviewLogs).values({
          cardId: card.id,
          userId: user.id,
          rating,
          queueBefore: log.queueBefore,
          intervalBefore: log.intervalBefore,
          interval: log.interval,
          easeBefore: log.easeBefore,
          ease: log.ease,
          delayMs: log.delay,
          durationMs: durationMs ?? null,
          reviewedAt: at(now),
          studyDay: dayNumber(now, ctx)
        })
      })
    )
    .pipe(Effect.orDie)
  return Option.some<AnswerResult>({ card: toStudyCard({ ...card, ...scheduled }), leech: log.leech })
})
