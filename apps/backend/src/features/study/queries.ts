import { type CardId, cards, type EntryId, type NoteId, notes, reviewLogs } from "@kotori/db"
import { asc, count, countDistinct, desc, eq, getTableColumns, gte, inArray, lt, lte, min, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { Learner } from "../../db/scopedToUser.ts"

// A learner's notes, cards and review history. Every query is scoped to one learner.

export type CardRow = typeof cards.$inferSelect
export type NoteRow = typeof notes.$inferSelect

/** A note as saved, and its cards; the learner is the one the query is scoped to. */
export type NewNote = Omit<typeof notes.$inferInsert, "userId">
export type NewCard = Omit<typeof cards.$inferInsert, "userId" | "noteId">

/** Saves a note with its cards, all or nothing. */
export const insertNote = Effect.fn("study.insertNote")(function* (
  learner: Learner,
  note: NewNote & { readonly id: NoteId },
  rows: ReadonlyArray<NewCard>
) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      const [saved] = yield* db
        .insert(notes)
        .values({ ...note, userId })
        .returning()
      const savedCards =
        rows.length === 0
          ? []
          : yield* db
              .insert(cards)
              .values(rows.map((card) => ({ ...card, userId, noteId: note.id })))
              .returning()
      return { note: saved!, cards: savedCards }
    })
  )
}, Effect.orDie)

const withCards = { cards: { orderBy: { template: "asc" } } } as const

/** The learner's notes, newest first, each with its cards. */
export const notesWithCards = (learner: Learner) =>
  learner.db.query.notes
    .findMany({ where: { userId: learner.userId }, orderBy: { createdAt: "desc" }, with: withCards })
    .pipe(Effect.orDie)

export const noteWithCards = (learner: Learner, noteId: NoteId) =>
  learner.db.query.notes
    .findFirst({ where: { userId: learner.userId, id: noteId }, with: withCards })
    .pipe(Effect.map(Option.fromNullishOr), Effect.orDie)

/** The outcome of deleting a note: missing notes are already successfully removed. */
export type NoteDeletion = "deleted" | "absent" | "forbidden"

/** Deletes an owned note, all of its cards and their logs in one transaction. */
export const deleteNote = Effect.fn("study.deleteNote")(function* (learner: Learner, noteId: NoteId) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      // Inspect ownership to distinguish another learner's note from one already gone.
      const [found] = yield* db.select({ userId: notes.userId }).from(notes).where(eq(notes.id, noteId)).limit(1)
      if (found === undefined) return "absent" as const
      if (found.userId !== userId) return "forbidden" as const

      // The foreign keys also cascade; explicitly remove children to preserve this operation
      // if those constraints change later. Every card on the note goes, including old reverse cards.
      const cardRows = yield* db.select({ id: cards.id }).from(cards).where(eq(cards.noteId, noteId))
      const cardIds = cardRows.map((row) => row.id)
      if (cardIds.length > 0) {
        yield* db.delete(reviewLogs).where(inArray(reviewLogs.cardId, cardIds))
        yield* db.delete(cards).where(eq(cards.noteId, noteId))
      }
      const removed = yield* db
        .delete(notes)
        .where(learner.owns(notes, eq(notes.id, noteId)))
        .returning({ id: notes.id })
      return removed.length > 0 ? ("deleted" as const) : ("absent" as const)
    })
  )
}, Effect.orDie)

/** The learner's word notes for the given entries. */
export const savedWords = Effect.fn("study.savedWords")(function* (learner: Learner, entryIds: ReadonlyArray<EntryId>) {
  if (entryIds.length === 0) return []
  const rows = yield* learner.db
    .select({ entryId: notes.entryId, sense: notes.sense, id: notes.id })
    .from(notes)
    .where(learner.owns(notes, inArray(notes.entryId, entryIds)))
    .pipe(Effect.orDie)
  return rows.flatMap((row) =>
    row.entryId === null || row.sense === null ? [] : [{ entryId: row.entryId, sense: row.sense, id: row.id }]
  )
})

/** A card with the note content it shows. */
const cardsWithContent = (learner: Learner) =>
  learner.db
    .select({ ...getTableColumns(cards), content: notes.content })
    .from(cards)
    .innerJoin(notes, eq(notes.id, cards.noteId))

export type CardWithContent = Effect.Success<ReturnType<typeof learningDue>>[number]

export const cardWithContent = (learner: Learner, cardId: CardId) =>
  cardsWithContent(learner)
    .where(learner.owns(cards, eq(cards.id, cardId)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

/** Cards in (re)learning due by `until`, soonest first. */
export const learningDue = (learner: Learner, until: Date) =>
  cardsWithContent(learner)
    .where(learner.owns(cards, inArray(cards.queue, ["learning", "relearning"]), lte(cards.due, until)))
    .orderBy(asc(cards.due))
    .pipe(Effect.orDie)

/** Review cards due by `until`, soonest first, at most `limit`. */
export const reviewDue = (learner: Learner, until: Date, limit: number) =>
  limit <= 0
    ? Effect.succeed([])
    : cardsWithContent(learner)
        .where(learner.owns(cards, eq(cards.queue, "review"), lte(cards.due, until)))
        .orderBy(asc(cards.due), asc(cards.seed))
        .limit(limit)
        .pipe(Effect.orDie)

/** New cards in the order they're introduced, at most `limit`. */
export const newCards = (learner: Learner, limit: number) =>
  limit <= 0
    ? Effect.succeed([])
    : cardsWithContent(learner)
        .where(learner.owns(cards, eq(cards.queue, "new")))
        .orderBy(asc(cards.position), asc(cards.template))
        .limit(limit)
        .pipe(Effect.orDie)

/** When the learner's next (re)learning card is due. */
export const nextLearningDue = (learner: Learner) =>
  learner.db
    .select({ due: min(cards.due) })
    .from(cards)
    .where(learner.owns(cards, inArray(cards.queue, ["learning", "relearning"])))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0]?.due)),
      Effect.orDie
    )

/** Cards answered on a study day; `queueBefore` narrows to, say, newly introduced ones. */
export const countAnswers = (learner: Learner, studyDay: number, queueBefore?: CardRow["queue"]) =>
  learner.db
    .select({ n: countDistinct(reviewLogs.cardId) })
    .from(reviewLogs)
    .where(
      learner.owns(
        reviewLogs,
        eq(reviewLogs.studyDay, studyDay),
        queueBefore === undefined ? undefined : eq(reviewLogs.queueBefore, queueBefore)
      )
    )
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )

/**
 * Records an answer: the card's new state and the review log, all or nothing. Says whether the
 * card was the learner's to answer; nothing is written when it isn't.
 */
export const answerCard = Effect.fn("study.answerCard")(function* (
  learner: Learner,
  cardId: CardId,
  state: Partial<Omit<typeof cards.$inferInsert, "id" | "noteId" | "userId">>,
  log: Omit<typeof reviewLogs.$inferInsert, "id" | "cardId" | "userId">
) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      const answered = yield* db
        .update(cards)
        .set(state)
        .where(learner.owns(cards, eq(cards.id, cardId)))
        .returning({ id: cards.id })
      if (answered.length === 0) return false
      yield* db.insert(reviewLogs).values({ ...log, cardId, userId })
      return true
    })
  )
}, Effect.orDie)

/** Where a new card goes in the learner's introduction order. */
export const nextPosition = (learner: Learner) =>
  learner.db
    .select({ n: sql<number>`coalesce(max(${cards.position}) + 1, 0)`.mapWith(Number) })
    .from(cards)
    .where(learner.owns(cards))
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )

const mature = sql<boolean>`(${cards.interval} >= 21)`

/** Card counts by queue, review cards split by whether they're mature. */
export const queueCounts = (learner: Learner) =>
  learner.db
    .select({ queue: cards.queue, mature, n: count() })
    .from(cards)
    .where(learner.owns(cards))
    .groupBy(cards.queue, mature)
    .pipe(Effect.orDie)

/** The study days the learner answered anything on, latest first (at most 400, for streaks). */
export const studyDays = (learner: Learner) =>
  learner.db
    .selectDistinct({ studyDay: reviewLogs.studyDay })
    .from(reviewLogs)
    .where(learner.owns(reviewLogs))
    .orderBy(desc(reviewLogs.studyDay))
    .limit(400)
    .pipe(
      Effect.map((rows) => rows.map((row) => row.studyDay)),
      Effect.orDie
    )

/** Review answers since a study day, and how many of them were "again". */
export const retention = (learner: Learner, sinceDay: number) =>
  learner.db
    .select({
      total: count(),
      failed: sql<number>`count(*) FILTER (WHERE ${reviewLogs.rating} = 'again')`.mapWith(Number)
    })
    .from(reviewLogs)
    .where(learner.owns(reviewLogs, eq(reviewLogs.queueBefore, "review"), gte(reviewLogs.studyDay, sinceDay)))
    .pipe(
      Effect.map((rows) => ({ total: rows[0]?.total ?? 0, failed: rows[0]?.failed ?? 0 })),
      Effect.orDie
    )

/** When each review card falls due, for those due before `until`. */
export const reviewDueTimes = (learner: Learner, until: Date) =>
  learner.db
    .select({ due: cards.due })
    .from(cards)
    .where(learner.owns(cards, eq(cards.queue, "review"), lt(cards.due, until)))
    .pipe(
      Effect.map((rows) => rows.map((row) => row.due)),
      Effect.orDie
    )

export const noteCount = (learner: Learner) => learner.db.$count(notes, learner.owns(notes)).pipe(Effect.orDie)
