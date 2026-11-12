import {
  NoteContent,
  NoteId,
  notes,
  PhraseNote,
  rating,
  retentionStage,
  SavedExample,
  UserId,
  WordNote
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { NoteContent, NoteId, PhraseNote, SavedExample, WordNote }

export const Rating = createSelectSchema(rating)
export type Rating = typeof Rating.Type

export const RetentionStage = createSelectSchema(retentionStage)
export type RetentionStage = typeof RetentionStage.Type

const NoteRow = createSelectSchema(notes, { id: NoteId, userId: UserId, content: NoteContent })

/** Where a note stands in the spaced-repetition schedule. */
export const NoteSchedule = Schema.Struct(
  Struct.pick(NoteRow.fields, ["retentionStage", "due", "interval", "ease", "reps", "lapses", "leech"])
)
export type NoteSchedule = typeof NoteSchedule.Type

/** A saved note: what it shows and where it stands in the review schedule. */
export const Note = Schema.Struct({
  ...Struct.pick(NoteRow.fields, ["id", "content", "createdAt"]),
  ...NoteSchedule.fields
})
export type Note = typeof Note.Type

/** Button labels such as "10m", "1d", "4d" for each rating. */
export const RatingLabels = Schema.Struct({
  again: Schema.String,
  hard: Schema.String,
  good: Schema.String,
  easy: Schema.String
})
export type RatingLabels = typeof RatingLabels.Type

/** A note to review, with what each rating would do to it. */
export const ReviewItem = Schema.Struct({ note: Note, labels: RatingLabels })
export type ReviewItem = typeof ReviewItem.Type

/** How many notes are due, by retention stage; relearning counts as learning. */
export const DueCounts = Schema.Struct({
  new: Schema.Int,
  learning: Schema.Int,
  review: Schema.Int
})
export type DueCounts = typeof DueCounts.Type

/** The notes a learner has to review now, in the order they will be shown. */
export const DueNotes = Schema.Struct({
  items: Schema.Array(ReviewItem),
  counts: DueCounts,
  /** Every note included in the counts, including those beyond `items`' page limit. */
  all: Schema.Array(Schema.Struct(Struct.pick(NoteRow.fields, ["id", "retentionStage"]))),
  /** When the next learning note becomes due, if nothing is due now. */
  nextDue: Schema.NullOr(NoteRow.fields.due)
})
export type DueNotes = typeof DueNotes.Type

export const AddNoteRequest = Schema.Struct({ content: NoteContent })
export type AddNoteRequest = typeof AddNoteRequest.Type

export const AnswerRequest = Schema.Struct({
  rating: Rating,
  /** How long the learner took to answer, when the client measured it. */
  durationMs: Schema.optional(Schema.Int)
})
export type AnswerRequest = typeof AnswerRequest.Type

export const AnswerResult = Schema.Struct({
  note: Note,
  /** True when this answer made the note a leech. */
  leech: Schema.Boolean
})
export type AnswerResult = typeof AnswerResult.Type

export const StudyStats = Schema.Struct({
  due: DueCounts,
  reviewedToday: Schema.Int,
  streak: Schema.Int,
  notes: Schema.Int,
  unseen: Schema.Int,
  young: Schema.Int,
  mature: Schema.Int,
  /** Share of review answers in the last 30 days that weren't "again". */
  retention: Schema.NullOr(Schema.Number),
  /** Notes due on each of the next 7 study days (today first). */
  forecast: Schema.Array(Schema.Int)
})
export type StudyStats = typeof StudyStats.Type
