import { NoteId, notes, rating, retentionStage, UserId } from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { Entry, EntryId, Example, Label } from "./Dictionary.ts"

export { NoteId }

export const Rating = createSelectSchema(rating)
export type Rating = typeof Rating.Type

export const RetentionStage = createSelectSchema(retentionStage)
export type RetentionStage = typeof RetentionStage.Type

const NoteRow = createSelectSchema(notes, { id: NoteId, userId: UserId, entryId: EntryId })

/** Where a note stands in the spaced-repetition schedule. */
export const NoteSchedule = Schema.Struct(
  Struct.pick(NoteRow.fields, ["retentionStage", "due", "interval", "ease", "reps", "lapses", "leech"])
)
export type NoteSchedule = typeof NoteSchedule.Type

/** The entry a note saves, as reviews and the notebook show it, read from the dictionary each time. */
export const NoteEntry = Schema.Struct(
  Struct.pick(Entry.fields, ["id", "language", "source", "review", "headword", "reading", "labels", "audioUrl"])
)
export type NoteEntry = typeof NoteEntry.Type

/** One sense of a note's entry, as a review shows it, and whether the note shows it. */
export const NoteSense = Schema.Struct({
  index: Schema.Int,
  /** What it means, in the other language from the headword. */
  glosses: Schema.Array(Schema.String),
  /** The labels it has beyond the word's (`NoteEntry.labels`). */
  labels: Schema.Array(Label),
  /** What is most worth remembering about it: its caution or the word's, else how it is used. */
  note: Schema.NullOr(Schema.String),
  /** Its first example sentence, when it has one. */
  example: Schema.NullOr(Example),
  /** False when the learner hid it from the note. */
  shown: Schema.Boolean
})
export type NoteSense = typeof NoteSense.Type

/** A saved note: the entry it saves, the senses it shows, and where it stands in the review schedule. */
export const Note = Schema.Struct({
  ...Struct.pick(NoteRow.fields, ["id", "createdAt"]),
  entry: NoteEntry,
  /**
   * Every sense of the entry: those the note shows first, in the learner's order, then the hidden
   * ones in the dictionary's. At least one is shown.
   */
  senses: Schema.Array(NoteSense),
  /** Whether the learner chose the senses; otherwise the note shows every sense, in the dictionary's order. */
  arranged: Schema.Boolean,
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

/**
 * Saves a dictionary entry, unreviewed drafts included. With `sense`, a shortcut: a new note shows
 * only that sense, and a note the entry already has shows it too. Saving an entry again returns
 * its note.
 */
export const AddNoteRequest = Schema.Struct({
  entryId: EntryId,
  sense: Schema.optional(Schema.Int)
})
export type AddNoteRequest = typeof AddNoteRequest.Type

/**
 * Chooses the senses a note shows, by index, in order (the rest are hidden); null shows every
 * sense in the dictionary's order again.
 */
export const UpdateNoteRequest = Schema.Struct({
  senses: Schema.NullOr(Schema.Array(Schema.Int).pipe(Schema.check(Schema.isMinLength(1))))
})
export type UpdateNoteRequest = typeof UpdateNoteRequest.Type

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
