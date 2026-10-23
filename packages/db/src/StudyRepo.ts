import { CardQueue, CardTemplate, NoteContent, Rating } from "@kotori/domain"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"

const decodeRows = <S extends Schema.Constraint>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))

const CardFields = {
  id: Schema.String,
  noteId: Schema.String,
  userId: Schema.String,
  template: CardTemplate,
  queue: CardQueue,
  due: Schema.Number,
  interval: Schema.Int,
  ease: Schema.Number,
  step: Schema.Int,
  reps: Schema.Int,
  lapses: Schema.Int,
  leech: Schema.Boolean,
  lastReview: Schema.NullOr(Schema.Number),
  seed: Schema.Int,
  position: Schema.Int,
  createdAt: Schema.Number
}

export const CardRow = Schema.Struct(CardFields)
export type CardRow = typeof CardRow.Type

export const CardWithContent = Schema.Struct({ ...CardFields, content: Schema.fromJsonString(NoteContent) })
export type CardWithContent = typeof CardWithContent.Type

export const NoteRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  content: Schema.fromJsonString(NoteContent),
  entryId: Schema.NullOr(Schema.Int),
  sense: Schema.NullOr(Schema.Int),
  createdAt: Schema.Number
})
export type NoteRow = typeof NoteRow.Type

export interface ReviewLogInput {
  readonly cardId: string
  readonly userId: string
  readonly rating: Rating
  readonly queueBefore: CardQueue
  readonly intervalBefore: number
  readonly interval: number
  readonly easeBefore: number
  readonly ease: number
  readonly delay: number
  readonly durationMs: number | null
  readonly reviewedAt: number
  readonly studyDay: number
}

const CountRow = Schema.Struct({ n: Schema.Int })
const DueRow = Schema.Struct({ due: Schema.NullOr(Schema.Number) })
const QueueCountRow = Schema.Struct({ queue: CardQueue, mature: Schema.Boolean, n: Schema.Int })
const DayRow = Schema.Struct({ studyDay: Schema.Int })
const RetentionRow = Schema.Struct({ total: Schema.Int, failed: Schema.NullOr(Schema.Int) })
const SavedRow = Schema.Struct({ entryId: Schema.Int, sense: Schema.Int, id: Schema.String })

const encodeCard = (card: CardRow) => ({
  id: card.id,
  noteId: card.noteId,
  userId: card.userId,
  template: card.template,
  queue: card.queue,
  due: card.due,
  interval: card.interval,
  ease: card.ease,
  step: card.step,
  reps: card.reps,
  lapses: card.lapses,
  leech: card.leech,
  lastReview: card.lastReview,
  seed: card.seed,
  position: card.position,
  createdAt: card.createdAt
})

export class StudyRepo extends Context.Service<
  StudyRepo,
  {
    insertNote(note: NoteRow, cards: ReadonlyArray<CardRow>): Effect.Effect<void>
    notes(
      userId: string
    ): Effect.Effect<ReadonlyArray<{ readonly note: NoteRow; readonly cards: ReadonlyArray<CardRow> }>>
    note(
      userId: string,
      noteId: string
    ): Effect.Effect<Option.Option<{ readonly note: NoteRow; readonly cards: ReadonlyArray<CardRow> }>>
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
      const sql = yield* SqlClient.SqlClient

      const cardColumns = sql.literal(
        "c.id, c.note_id, c.user_id, c.template, c.queue, c.due, c.interval, c.ease, c.step, c.reps, c.lapses, c.leech, c.last_review, c.seed, c.position, c.created_at"
      )

      const insertNote = Effect.fn("StudyRepo.insertNote")(
        function* (note: NoteRow, cards: ReadonlyArray<CardRow>) {
          yield* sql`INSERT INTO notes ${sql.insert({ ...note, kind: note.content.kind, content: JSON.stringify(note.content) })}`
          if (cards.length > 0) yield* sql`INSERT INTO cards ${sql.insert(cards.map(encodeCard))}`
        },
        (effect) => sql.withTransaction(effect),
        Effect.orDie
      )

      const cardsFor = (noteIds: ReadonlyArray<string>) =>
        noteIds.length === 0
          ? Effect.succeed([])
          : sql`SELECT ${cardColumns} FROM cards c WHERE c.note_id IN ${sql.in(noteIds)} ORDER BY c.template DESC`.pipe(
              Effect.flatMap(decodeRows(CardRow))
            )

      const withCards = (notes: ReadonlyArray<NoteRow>) =>
        cardsFor(notes.map((note) => note.id)).pipe(
          Effect.map((cards) => notes.map((note) => ({ note, cards: cards.filter((card) => card.noteId === note.id) })))
        )

      const notes = Effect.fn("StudyRepo.notes")(function* (userId: string) {
        const rows = yield* sql`
          SELECT id, user_id, content, entry_id, sense, created_at FROM notes
          WHERE user_id = ${userId} ORDER BY created_at DESC
        `.pipe(Effect.flatMap(decodeRows(NoteRow)))
        return yield* withCards(rows)
      }, Effect.orDie)

      const note = Effect.fn("StudyRepo.note")(function* (userId: string, noteId: string) {
        const rows = yield* sql`
          SELECT id, user_id, content, entry_id, sense, created_at FROM notes
          WHERE user_id = ${userId} AND id = ${noteId}
        `.pipe(Effect.flatMap(decodeRows(NoteRow)))
        const found = yield* withCards(rows)
        return Option.fromNullishOr(found[0])
      }, Effect.orDie)

      const deleteNote = Effect.fn("StudyRepo.deleteNote")(function* (userId: string, noteId: string) {
        const rows = yield* sql`DELETE FROM notes WHERE user_id = ${userId} AND id = ${noteId} RETURNING id`
        return rows.length > 0
      }, Effect.orDie)

      const savedWords = Effect.fn("StudyRepo.savedWords")(function* (userId: string, entryIds: ReadonlyArray<number>) {
        if (entryIds.length === 0) return []
        return yield* sql`
          SELECT entry_id, sense, id FROM notes
          WHERE user_id = ${userId} AND entry_id IN ${sql.in(entryIds)}
        `.pipe(Effect.flatMap(decodeRows(SavedRow)))
      }, Effect.orDie)

      const card = Effect.fn("StudyRepo.card")(function* (userId: string, cardId: string) {
        const rows = yield* sql`
          SELECT ${cardColumns}, n.content FROM cards c JOIN notes n ON n.id = c.note_id
          WHERE c.user_id = ${userId} AND c.id = ${cardId}
        `.pipe(Effect.flatMap(decodeRows(CardWithContent)))
        return Option.fromNullishOr(rows[0])
      }, Effect.orDie)

      const learningDue = Effect.fn("StudyRepo.learningDue")(function* (userId: string, until: number) {
        return yield* sql`
          SELECT ${cardColumns}, n.content FROM cards c JOIN notes n ON n.id = c.note_id
          WHERE c.user_id = ${userId} AND c.queue IN ('learning', 'relearning') AND c.due <= ${until}
          ORDER BY c.due
        `.pipe(Effect.flatMap(decodeRows(CardWithContent)))
      }, Effect.orDie)

      const reviewDue = Effect.fn("StudyRepo.reviewDue")(function* (userId: string, until: number, limit: number) {
        if (limit <= 0) return []
        return yield* sql`
          SELECT ${cardColumns}, n.content FROM cards c JOIN notes n ON n.id = c.note_id
          WHERE c.user_id = ${userId} AND c.queue = 'review' AND c.due <= ${until}
          ORDER BY c.due, c.seed
          LIMIT ${limit}
        `.pipe(Effect.flatMap(decodeRows(CardWithContent)))
      }, Effect.orDie)

      const newCards = Effect.fn("StudyRepo.newCards")(function* (userId: string, limit: number) {
        if (limit <= 0) return []
        return yield* sql`
          SELECT ${cardColumns}, n.content FROM cards c JOIN notes n ON n.id = c.note_id
          WHERE c.user_id = ${userId} AND c.queue = 'new'
          ORDER BY c.position, c.template DESC
          LIMIT ${limit}
        `.pipe(Effect.flatMap(decodeRows(CardWithContent)))
      }, Effect.orDie)

      const nextLearningDue = (userId: string) =>
        sql`
          SELECT min(due) AS due FROM cards WHERE user_id = ${userId} AND queue IN ('learning', 'relearning')
        `.pipe(
          Effect.flatMap(decodeRows(DueRow)),
          Effect.map((rows) => Option.fromNullishOr(rows[0]?.due)),
          Effect.orDie
        )

      const countAnswers = (userId: string, studyDay: number, queueBefore?: CardQueue) =>
        sql`
          SELECT count(DISTINCT card_id) AS n FROM review_logs
          WHERE user_id = ${userId} AND study_day = ${studyDay}
          ${queueBefore === undefined ? sql.literal("") : sql`AND queue_before = ${queueBefore}`}
        `.pipe(
          Effect.flatMap(decodeRows(CountRow)),
          Effect.map((rows) => rows[0]?.n ?? 0),
          Effect.orDie
        )

      const updateCard = (card: CardRow) =>
        sql`UPDATE cards SET ${sql.update(encodeCard(card), ["id"])} WHERE id = ${card.id}`.pipe(
          Effect.asVoid,
          Effect.orDie
        )

      const insertLog = (log: ReviewLogInput) =>
        sql`INSERT INTO review_logs ${sql.insert({ ...log })}`.pipe(Effect.asVoid, Effect.orDie)

      const nextPosition = (userId: string) =>
        sql`SELECT coalesce(max(position) + 1, 0) AS n FROM cards WHERE user_id = ${userId}`.pipe(
          Effect.flatMap(decodeRows(CountRow)),
          Effect.map((rows) => rows[0]?.n ?? 0),
          Effect.orDie
        )

      const queueCounts = (userId: string) =>
        sql`
          SELECT c.queue, (c.interval >= 21) AS mature, count(*) AS n FROM cards c
          WHERE c.user_id = ${userId} GROUP BY c.queue, mature
        `.pipe(Effect.flatMap(decodeRows(QueueCountRow)), Effect.orDie)

      const studyDays = (userId: string) =>
        sql`
          SELECT DISTINCT study_day FROM review_logs WHERE user_id = ${userId} ORDER BY study_day DESC LIMIT 400
        `.pipe(
          Effect.flatMap(decodeRows(DayRow)),
          Effect.map((rows) => rows.map((row) => row.studyDay)),
          Effect.orDie
        )

      const retention = (userId: string, sinceDay: number) =>
        sql`
          SELECT count(*) AS total, count(*) FILTER (WHERE rating = 'again') AS failed FROM review_logs
          WHERE user_id = ${userId} AND queue_before = 'review' AND study_day >= ${sinceDay}
        `.pipe(
          Effect.flatMap(decodeRows(RetentionRow)),
          Effect.map((rows) => ({ total: rows[0]?.total ?? 0, failed: rows[0]?.failed ?? 0 })),
          Effect.orDie
        )

      const reviewDueTimes = (userId: string, until: number) =>
        sql`SELECT due FROM cards WHERE user_id = ${userId} AND queue = 'review' AND due < ${until}`.pipe(
          Effect.flatMap(decodeRows(DueRow)),
          Effect.map((rows) => rows.flatMap((row) => (row.due === null ? [] : [row.due]))),
          Effect.orDie
        )

      const noteCount = (userId: string) =>
        sql`SELECT count(*) AS n FROM notes WHERE user_id = ${userId}`.pipe(
          Effect.flatMap(decodeRows(CountRow)),
          Effect.map((rows) => rows[0]?.n ?? 0),
          Effect.orDie
        )

      return StudyRepo.of({
        insertNote,
        notes,
        note,
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
