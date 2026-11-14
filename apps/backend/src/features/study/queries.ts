import type { SenseLayout } from "@kotori/contracts"
import { type EntryId, type NoteId, notes, reviewLogs } from "@kotori/db"
import { asc, count, countDistinct, desc, eq, gte, inArray, lt, lte, min, sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import type { Learner } from "../../db/scopedToUser.ts"

// A learner's notes and review history. Every query is scoped to one learner.

export type NoteRow = typeof notes.$inferSelect

/** A note as saved; the learner is the one the query is scoped to. */
export type NewNote = Omit<typeof notes.$inferInsert, "userId">

/**
 * Saves a note, new and due now unless the caller says otherwise. A learner has one note per
 * entry: when two saves race, the second finds the first's note, and so does every later one.
 */
export const insertNote = Effect.fn("study.insertNote")(function* (
  learner: Learner,
  note: NewNote & { readonly id: NoteId }
) {
  yield* learner.db
    .insert(notes)
    .values({ ...note, userId: learner.userId })
    .onConflictDoNothing({ target: [notes.userId, notes.entryId] })
  return Option.getOrThrow(yield* noteByEntry(learner, note.entryId))
}, Effect.orDie)

/** The learner's notes, newest first. */
export const allNotes = (learner: Learner) =>
  learner.db.select().from(notes).where(learner.owns(notes)).orderBy(desc(notes.createdAt)).pipe(Effect.orDie)

export const noteById = (learner: Learner, noteId: NoteId) =>
  learner.db
    .select()
    .from(notes)
    .where(learner.owns(notes, eq(notes.id, noteId)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

/** The outcome of deleting a note: missing notes are already successfully removed. */
export type NoteDeletion = "deleted" | "absent" | "forbidden"

/** Deletes an owned note and its review logs in one transaction. */
export const deleteNote = Effect.fn("study.deleteNote")(function* (learner: Learner, noteId: NoteId) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      // Inspect ownership to distinguish another learner's note from one already gone.
      const [found] = yield* db.select({ userId: notes.userId }).from(notes).where(eq(notes.id, noteId)).limit(1)
      if (found === undefined) return "absent" as const
      if (found.userId !== userId) return "forbidden" as const

      // The foreign key also cascades; explicitly remove the logs to preserve this operation
      // if that constraint changes later.
      yield* db.delete(reviewLogs).where(eq(reviewLogs.noteId, noteId))
      const removed = yield* db
        .delete(notes)
        .where(learner.owns(notes, eq(notes.id, noteId)))
        .returning({ id: notes.id })
      return removed.length > 0 ? ("deleted" as const) : ("absent" as const)
    })
  )
}, Effect.orDie)

/** The learner's note on an entry, if they saved it. */
export const noteByEntry = (learner: Learner, entryId: EntryId) =>
  learner.db
    .select()
    .from(notes)
    .where(learner.owns(notes, eq(notes.entryId, entryId)))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

/** Sets which senses an owned note shows, in order (null for every sense); none when it isn't theirs. */
export const arrangeNote = (learner: Learner, noteId: NoteId, senses: SenseLayout) =>
  learner.db
    .update(notes)
    .set({ senses: senses === null ? null : [...senses] })
    .where(learner.owns(notes, eq(notes.id, noteId)))
    .returning()
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
      Effect.orDie
    )

/** Notes in (re)learning due by `until`, soonest first. */
export const learningDue = (learner: Learner, until: Date) =>
  learner.db
    .select()
    .from(notes)
    .where(learner.owns(notes, inArray(notes.retentionStage, ["learning", "relearning"]), lte(notes.due, until)))
    .orderBy(asc(notes.due))
    .pipe(Effect.orDie)

/** Notes in review due by `until`, soonest first, at most `limit`. */
export const reviewDue = (learner: Learner, until: Date, limit: number) =>
  limit <= 0
    ? Effect.succeed([])
    : learner.db
        .select()
        .from(notes)
        .where(learner.owns(notes, eq(notes.retentionStage, "review"), lte(notes.due, until)))
        .orderBy(asc(notes.due), asc(notes.seed))
        .limit(limit)
        .pipe(Effect.orDie)

/** New notes in the order they're introduced, at most `limit`. */
export const newNotes = (learner: Learner, limit: number) =>
  limit <= 0
    ? Effect.succeed([])
    : learner.db
        .select()
        .from(notes)
        .where(learner.owns(notes, eq(notes.retentionStage, "new")))
        .orderBy(asc(notes.position), asc(notes.id))
        .limit(limit)
        .pipe(Effect.orDie)

/** When the learner's next (re)learning note is due. */
export const nextLearningDue = (learner: Learner) =>
  learner.db
    .select({ due: min(notes.due) })
    .from(notes)
    .where(learner.owns(notes, inArray(notes.retentionStage, ["learning", "relearning"])))
    .pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0]?.due)),
      Effect.orDie
    )

/** Notes reviewed on a study day; `stageBefore` narrows to, say, newly introduced ones. */
export const countReviewed = (learner: Learner, studyDay: number, stageBefore?: NoteRow["retentionStage"]) =>
  learner.db
    .select({ n: countDistinct(reviewLogs.noteId) })
    .from(reviewLogs)
    .where(
      learner.owns(
        reviewLogs,
        eq(reviewLogs.studyDay, studyDay),
        stageBefore === undefined ? undefined : eq(reviewLogs.retentionStageBefore, stageBefore)
      )
    )
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )

/** A note's place in the schedule: what a review changes. */
export type NoteSchedule = Pick<
  NoteRow,
  "retentionStage" | "due" | "interval" | "ease" | "step" | "reps" | "lapses" | "leech" | "lastReview"
>

/**
 * Records a review: the note's new schedule and the review log, all or nothing. Says whether the
 * note was the learner's to review; nothing is written when it isn't.
 */
export const saveReview = Effect.fn("study.saveReview")(function* (
  learner: Learner,
  noteId: NoteId,
  schedule: Partial<NoteSchedule>,
  log: Omit<typeof reviewLogs.$inferInsert, "id" | "noteId" | "userId">
) {
  const { db, userId } = learner
  return yield* db.transaction(() =>
    Effect.gen(function* () {
      const reviewed = yield* db
        .update(notes)
        .set(schedule)
        .where(learner.owns(notes, eq(notes.id, noteId)))
        .returning({ id: notes.id })
      if (reviewed.length === 0) return false
      yield* db.insert(reviewLogs).values({ ...log, noteId, userId })
      return true
    })
  )
}, Effect.orDie)

/** Where a new note goes in the learner's introduction order. */
export const nextPosition = (learner: Learner) =>
  learner.db
    .select({ n: sql<number>`coalesce(max(${notes.position}) + 1, 0)`.mapWith(Number) })
    .from(notes)
    .where(learner.owns(notes))
    .pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
      Effect.orDie
    )

const mature = sql<boolean>`(${notes.interval} >= 21)`

/** Note counts by retention stage, those in review split by whether they're mature. */
export const stageCounts = (learner: Learner) =>
  learner.db
    .select({ retentionStage: notes.retentionStage, mature, n: count() })
    .from(notes)
    .where(learner.owns(notes))
    .groupBy(notes.retentionStage, mature)
    .pipe(Effect.orDie)

/** The study days the learner reviewed anything on, latest first (at most 400, for streaks). */
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

/** Reviews of notes in the review stage since a study day, and how many of them were "again". */
export const retention = (learner: Learner, sinceDay: number) =>
  learner.db
    .select({
      total: count(),
      failed: sql<number>`count(*) FILTER (WHERE ${reviewLogs.rating} = 'again')`.mapWith(Number)
    })
    .from(reviewLogs)
    .where(learner.owns(reviewLogs, eq(reviewLogs.retentionStageBefore, "review"), gte(reviewLogs.studyDay, sinceDay)))
    .pipe(
      Effect.map((rows) => ({ total: rows[0]?.total ?? 0, failed: rows[0]?.failed ?? 0 })),
      Effect.orDie
    )

/** When each note in review falls due, for those due before `until`. */
export const reviewDueTimes = (learner: Learner, until: Date) =>
  learner.db
    .select({ due: notes.due })
    .from(notes)
    .where(learner.owns(notes, eq(notes.retentionStage, "review"), lt(notes.due, until)))
    .pipe(
      Effect.map((rows) => rows.map((row) => row.due)),
      Effect.orDie
    )

export const noteCount = (learner: Learner) => learner.db.$count(notes, learner.owns(notes)).pipe(Effect.orDie)
