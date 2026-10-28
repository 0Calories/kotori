import type { CardQueue, CardTemplate, NoteContent, Rating } from "@kotori/domain"
import { and, asc, count, countDistinct, desc, eq, getTableColumns, gte, inArray, lt, lte, min, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { Database } from "./Database.ts"
import { at, atOrNull, millis, millisOrNull } from "./rows.ts"
import { cards, notes, reviewLogs } from "./schema/index.ts"

export interface CardRow {
  readonly id: string
  readonly noteId: string
  readonly userId: string
  readonly template: CardTemplate
  readonly queue: CardQueue
  readonly due: number
  readonly interval: number
  readonly ease: number
  readonly step: number
  readonly reps: number
  readonly lapses: number
  readonly leech: boolean
  readonly lastReview: number | null
  readonly seed: number
  readonly position: number
  readonly createdAt: number
}

export interface CardWithContent extends CardRow {
  readonly content: NoteContent
}

export interface NoteRow {
  readonly id: string
  readonly userId: string
  readonly content: NoteContent
  readonly entryId: number | null
  readonly sense: number | null
  readonly createdAt: number
}

export interface ReviewLogInput {
  readonly cardId: string
  readonly userId: string
  readonly rating: Rating
  readonly queueBefore: CardQueue
  readonly intervalBefore: number
  readonly interval: number
  readonly easeBefore: number
  readonly ease: number
  /** How late the review was, in milliseconds. */
  readonly delayMs: number
  readonly durationMs: number | null
  readonly reviewedAt: number
  readonly studyDay: number
}

export interface NoteWithCards {
  readonly note: NoteRow
  readonly cards: ReadonlyArray<CardRow>
}

const toCard = (card: typeof cards.$inferSelect): CardRow => ({
  ...card,
  due: millis(card.due),
  lastReview: millisOrNull(card.lastReview),
  createdAt: millis(card.createdAt)
})

const toNote = (note: typeof notes.$inferSelect): NoteRow => ({
  id: note.id,
  userId: note.userId,
  content: note.content,
  entryId: note.entryId,
  sense: note.sense,
  createdAt: millis(note.createdAt)
})

const fromCard = (card: CardRow): typeof cards.$inferInsert => ({
  ...card,
  due: at(card.due),
  lastReview: atOrNull(card.lastReview),
  createdAt: at(card.createdAt)
})

export class StudyRepo extends Context.Service<
  StudyRepo,
  {
    insertNote(note: NoteRow, cards: ReadonlyArray<CardRow>): Effect.Effect<void>
    /** The learner's notes, newest first, each with its cards. */
    notes(userId: string): Effect.Effect<ReadonlyArray<NoteWithCards>>
    note(userId: string, noteId: string): Effect.Effect<Option.Option<NoteWithCards>>
    /** Returns whether a note was deleted. */
    deleteNote(userId: string, noteId: string): Effect.Effect<boolean>
    /** Saved word notes for the given entries. */
    savedWords(
      userId: string,
      entryIds: ReadonlyArray<number>
    ): Effect.Effect<ReadonlyArray<{ entryId: number; sense: number; id: string }>>
    card(userId: string, cardId: string): Effect.Effect<Option.Option<CardWithContent>>
    learningDue(userId: string, until: number): Effect.Effect<ReadonlyArray<CardWithContent>>
    reviewDue(userId: string, until: number, limit: number): Effect.Effect<ReadonlyArray<CardWithContent>>
    newCards(userId: string, limit: number): Effect.Effect<ReadonlyArray<CardWithContent>>
    nextLearningDue(userId: string): Effect.Effect<Option.Option<number>>
    /** Answers logged on a study day; `queueBefore` narrows to e.g. newly introduced cards. */
    countAnswers(userId: string, studyDay: number, queueBefore?: CardQueue): Effect.Effect<number>
    updateCard(card: CardRow): Effect.Effect<void>
    insertLog(log: ReviewLogInput): Effect.Effect<void>
    nextPosition(userId: string): Effect.Effect<number>
    queueCounts(userId: string): Effect.Effect<ReadonlyArray<{ queue: CardQueue; mature: boolean; n: number }>>
    studyDays(userId: string): Effect.Effect<ReadonlyArray<number>>
    retention(userId: string, sinceDay: number): Effect.Effect<{ total: number; failed: number }>
    reviewDueTimes(userId: string, until: number): Effect.Effect<ReadonlyArray<number>>
    readonly noteCount: (userId: string) => Effect.Effect<number>
  }
>()("@kotori/db/StudyRepo") {
  static readonly layer = Layer.effect(
    StudyRepo,
    Effect.gen(function* () {
      const db = yield* Database

      const insertNote = Effect.fn("StudyRepo.insertNote")(function* (note: NoteRow, rows: ReadonlyArray<CardRow>) {
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(notes).values({ ...note, kind: note.content.kind, createdAt: at(note.createdAt) })
            if (rows.length > 0) yield* tx.insert(cards).values(rows.map(fromCard))
          })
        )
      }, Effect.orDie)

      const withCards = (
        rows: ReadonlyArray<typeof notes.$inferSelect & { cards: Array<typeof cards.$inferSelect> }>
      ) =>
        rows.map(({ cards: cardRows, ...note }): NoteWithCards => ({ note: toNote(note), cards: cardRows.map(toCard) }))

      const notesFor = Effect.fn("StudyRepo.notes")(function* (userId: string) {
        const rows = yield* db.query.notes.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          with: { cards: { orderBy: { template: "asc" } } }
        })
        return withCards(rows)
      }, Effect.orDie)

      const noteFor = Effect.fn("StudyRepo.note")(function* (userId: string, noteId: string) {
        const row = yield* db.query.notes.findFirst({
          where: { userId, id: noteId },
          with: { cards: { orderBy: { template: "asc" } } }
        })
        return Option.fromNullishOr(row).pipe(Option.map((found) => withCards([found])[0]!))
      }, Effect.orDie)

      const deleteNote = Effect.fn("StudyRepo.deleteNote")(function* (userId: string, noteId: string) {
        const rows = yield* db
          .delete(notes)
          .where(and(eq(notes.userId, userId), eq(notes.id, noteId)))
          .returning({ id: notes.id })
        return rows.length > 0
      }, Effect.orDie)

      const savedWords = Effect.fn("StudyRepo.savedWords")(function* (userId: string, entryIds: ReadonlyArray<number>) {
        if (entryIds.length === 0) return []
        const rows = yield* db
          .select({ entryId: notes.entryId, sense: notes.sense, id: notes.id })
          .from(notes)
          .where(and(eq(notes.userId, userId), inArray(notes.entryId, entryIds)))
        return rows.flatMap((row) =>
          row.entryId === null || row.sense === null ? [] : [{ entryId: row.entryId, sense: row.sense, id: row.id }]
        )
      }, Effect.orDie)

      const cardsWithContent = { ...getTableColumns(cards), content: notes.content }
      const toCardWithContent = (row: typeof cards.$inferSelect & { content: NoteContent }): CardWithContent => ({
        ...toCard(row),
        content: row.content
      })

      const card = Effect.fn("StudyRepo.card")(function* (userId: string, cardId: string) {
        const rows = yield* db
          .select(cardsWithContent)
          .from(cards)
          .innerJoin(notes, eq(notes.id, cards.noteId))
          .where(and(eq(cards.userId, userId), eq(cards.id, cardId)))
        return Option.fromNullishOr(rows[0]).pipe(Option.map(toCardWithContent))
      }, Effect.orDie)

      const learningDue = Effect.fn("StudyRepo.learningDue")(function* (userId: string, until: number) {
        const rows = yield* db
          .select(cardsWithContent)
          .from(cards)
          .innerJoin(notes, eq(notes.id, cards.noteId))
          .where(
            and(eq(cards.userId, userId), inArray(cards.queue, ["learning", "relearning"]), lte(cards.due, at(until)))
          )
          .orderBy(asc(cards.due))
        return rows.map(toCardWithContent)
      }, Effect.orDie)

      const reviewDue = Effect.fn("StudyRepo.reviewDue")(function* (userId: string, until: number, limit: number) {
        if (limit <= 0) return []
        const rows = yield* db
          .select(cardsWithContent)
          .from(cards)
          .innerJoin(notes, eq(notes.id, cards.noteId))
          .where(and(eq(cards.userId, userId), eq(cards.queue, "review"), lte(cards.due, at(until))))
          .orderBy(asc(cards.due), asc(cards.seed))
          .limit(limit)
        return rows.map(toCardWithContent)
      }, Effect.orDie)

      const newCards = Effect.fn("StudyRepo.newCards")(function* (userId: string, limit: number) {
        if (limit <= 0) return []
        const rows = yield* db
          .select(cardsWithContent)
          .from(cards)
          .innerJoin(notes, eq(notes.id, cards.noteId))
          .where(and(eq(cards.userId, userId), eq(cards.queue, "new")))
          .orderBy(asc(cards.position), asc(cards.template))
          .limit(limit)
        return rows.map(toCardWithContent)
      }, Effect.orDie)

      const nextLearningDue = (userId: string) =>
        db
          .select({ due: min(cards.due) })
          .from(cards)
          .where(and(eq(cards.userId, userId), inArray(cards.queue, ["learning", "relearning"])))
          .pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0]?.due).pipe(Option.map(millis))),
            Effect.orDie
          )

      const countAnswers = (userId: string, studyDay: number, queueBefore?: CardQueue) =>
        db
          .select({ n: countDistinct(reviewLogs.cardId) })
          .from(reviewLogs)
          .where(
            and(
              eq(reviewLogs.userId, userId),
              eq(reviewLogs.studyDay, studyDay),
              queueBefore === undefined ? undefined : eq(reviewLogs.queueBefore, queueBefore)
            )
          )
          .pipe(
            Effect.map((rows) => rows[0]?.n ?? 0),
            Effect.orDie
          )

      const updateCard = (row: CardRow) => {
        const { id: _, ...fields } = fromCard(row)
        return db.update(cards).set(fields).where(eq(cards.id, row.id)).pipe(Effect.asVoid, Effect.orDie)
      }

      const insertLog = (log: ReviewLogInput) =>
        db
          .insert(reviewLogs)
          .values({ ...log, reviewedAt: at(log.reviewedAt) })
          .pipe(Effect.asVoid, Effect.orDie)

      const nextPosition = (userId: string) =>
        db
          .select({ n: sql<number>`coalesce(max(${cards.position}) + 1, 0)`.mapWith(Number) })
          .from(cards)
          .where(eq(cards.userId, userId))
          .pipe(
            Effect.map((rows) => rows[0]?.n ?? 0),
            Effect.orDie
          )

      const mature = sql<boolean>`(${cards.interval} >= 21)`

      const queueCounts = (userId: string) =>
        db
          .select({ queue: cards.queue, mature, n: count() })
          .from(cards)
          .where(eq(cards.userId, userId))
          .groupBy(cards.queue, mature)
          .pipe(Effect.orDie)

      const studyDays = (userId: string) =>
        db
          .selectDistinct({ studyDay: reviewLogs.studyDay })
          .from(reviewLogs)
          .where(eq(reviewLogs.userId, userId))
          .orderBy(desc(reviewLogs.studyDay))
          .limit(400)
          .pipe(
            Effect.map((rows) => rows.map((row) => row.studyDay)),
            Effect.orDie
          )

      const retention = (userId: string, sinceDay: number) =>
        db
          .select({
            total: count(),
            failed: sql<number>`count(*) FILTER (WHERE ${reviewLogs.rating} = 'again')`.mapWith(Number)
          })
          .from(reviewLogs)
          .where(
            and(eq(reviewLogs.userId, userId), eq(reviewLogs.queueBefore, "review"), gte(reviewLogs.studyDay, sinceDay))
          )
          .pipe(
            Effect.map((rows) => ({ total: rows[0]?.total ?? 0, failed: rows[0]?.failed ?? 0 })),
            Effect.orDie
          )

      const reviewDueTimes = (userId: string, until: number) =>
        db
          .select({ due: cards.due })
          .from(cards)
          .where(and(eq(cards.userId, userId), eq(cards.queue, "review"), lt(cards.due, at(until))))
          .pipe(
            Effect.map((rows) => rows.map((row) => millis(row.due))),
            Effect.orDie
          )

      const noteCount = (userId: string) => db.$count(notes, eq(notes.userId, userId)).pipe(Effect.orDie)

      return StudyRepo.of({
        insertNote,
        notes: notesFor,
        note: noteFor,
        deleteNote,
        savedWords,
        card,
        learningDue,
        reviewDue,
        newCards,
        nextLearningDue,
        countAnswers,
        updateCard,
        insertLog,
        nextPosition,
        queueCounts,
        studyDays,
        retention,
        reviewDueTimes,
        noteCount
      })
    })
  )
}
