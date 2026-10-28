import { at, Database, millis } from "@kotori/db"
import { cards, notes, reviewLogs } from "@kotori/db/schema"
import type { Profile, StudyStats } from "@kotori/domain"
import { dayNumber, dayStart } from "@kotori/srs"
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm"
import { Clock, Effect } from "effect"
import { clockFor, countAnswers, due } from "./queue.ts"

/** Cards whose interval has reached three weeks, as Anki counts them. */
const mature = sql<boolean>`(${cards.interval} >= 21)`

/** What's due, today's reviews, the streak, the collection by maturity, retention and a week's forecast. */
export const stats = Effect.fn("study.stats")(function* (user: Profile) {
  const db = yield* Database
  const now = yield* Clock.currentTimeMillis
  const clock = clockFor(user, now)
  const today = dayNumber(now, clock)
  const { learning, reviews, fresh } = yield* due(user, now)

  const days = yield* db
    .selectDistinct({ studyDay: reviewLogs.studyDay })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, user.id))
    .orderBy(desc(reviewLogs.studyDay))
    .limit(400)
  let streak = 0
  let expected = days[0]?.studyDay === today ? today : today - 1
  for (const { studyDay } of days) {
    if (studyDay !== expected) break
    streak++
    expected--
  }

  const byQueue = yield* db
    .select({ queue: cards.queue, mature, n: count() })
    .from(cards)
    .where(eq(cards.userId, user.id))
    .groupBy(cards.queue, mature)
  const total = (filter: (row: (typeof byQueue)[number]) => boolean) =>
    byQueue.filter(filter).reduce((sum, row) => sum + row.n, 0)

  const [retention] = yield* db
    .select({
      total: count(),
      failed: sql<number>`count(*) FILTER (WHERE ${reviewLogs.rating} = 'again')`.mapWith(Number)
    })
    .from(reviewLogs)
    .where(
      and(eq(reviewLogs.userId, user.id), eq(reviewLogs.queueBefore, "review"), gte(reviewLogs.studyDay, today - 30))
    )
  const dueTimes = yield* db
    .select({ due: cards.due })
    .from(cards)
    .where(and(eq(cards.userId, user.id), eq(cards.queue, "review"), lt(cards.due, at(dayStart(today + 7, clock)))))
  const forecast = Array.from(
    { length: 7 },
    (_, offset) =>
      dueTimes.filter((row) => Math.max(dayNumber(millis(row.due), clock), today) === today + offset).length
  )

  return {
    due: { new: fresh.length, learning: learning.length, review: reviews.length },
    reviewedToday: yield* countAnswers(user.id, today),
    streak,
    notes: yield* db.$count(notes, eq(notes.userId, user.id)),
    cards: total(() => true),
    unseen: total((row) => row.queue === "new"),
    young: total((row) => row.queue !== "new" && !(row.queue === "review" && row.mature)),
    mature: total((row) => row.queue === "review" && row.mature),
    retention: retention === undefined || retention.total === 0 ? null : 1 - retention.failed / retention.total,
    forecast
  } satisfies StudyStats
}, Effect.orDie)
