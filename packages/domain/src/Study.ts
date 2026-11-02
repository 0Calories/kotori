import { NoteContent, PhraseNote, SavedExample, WordNote } from "@kotori/db"
import * as Schema from "effect/Schema"

export { NoteContent, PhraseNote, SavedExample, WordNote }

export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

export const CardId = Schema.String.pipe(Schema.brand("CardId"))
export type CardId = typeof CardId.Type

export const Rating = Schema.Literals(["again", "hard", "good", "easy"])
export type Rating = typeof Rating.Type

export const CardQueue = Schema.Literals(["new", "learning", "review", "relearning"])
export type CardQueue = typeof CardQueue.Type

/**
 * recognize: show the word in the target language and ask for the meaning.
 * produce: the retired reverse direction. The column's enum still has the value; a migration
 * deletes those cards and their review logs, and new notes are not given one.
 */
export const CardTemplate = Schema.Literals(["recognize", "produce"])
export type CardTemplate = typeof CardTemplate.Type

export const CardSummary = Schema.Struct({
  id: CardId,
  template: CardTemplate,
  queue: CardQueue,
  due: Schema.Number,
  interval: Schema.Int,
  leech: Schema.Boolean
})
export type CardSummary = typeof CardSummary.Type

export const Note = Schema.Struct({
  id: NoteId,
  content: NoteContent,
  createdAt: Schema.Number,
  cards: Schema.Array(CardSummary)
})
export type Note = typeof Note.Type

export const StudyCard = Schema.Struct({
  id: CardId,
  noteId: NoteId,
  template: CardTemplate,
  queue: CardQueue,
  due: Schema.Number,
  interval: Schema.Int,
  ease: Schema.Number,
  reps: Schema.Int,
  lapses: Schema.Int,
  leech: Schema.Boolean,
  content: NoteContent
})
export type StudyCard = typeof StudyCard.Type

/** Button labels such as "10m", "1d", "4d" for each answer. */
export const AnswerLabels = Schema.Struct({
  again: Schema.String,
  hard: Schema.String,
  good: Schema.String,
  easy: Schema.String
})
export type AnswerLabels = typeof AnswerLabels.Type

export const ReviewItem = Schema.Struct({ card: StudyCard, labels: AnswerLabels })
export type ReviewItem = typeof ReviewItem.Type

export const QueueCounts = Schema.Struct({
  new: Schema.Int,
  learning: Schema.Int,
  review: Schema.Int
})
export type QueueCounts = typeof QueueCounts.Type

export const ReviewQueue = Schema.Struct({
  items: Schema.Array(ReviewItem),
  counts: QueueCounts,
  /** When the next learning card becomes due, if nothing is due now. */
  nextDue: Schema.NullOr(Schema.Number)
})
export type ReviewQueue = typeof ReviewQueue.Type

export const AddNoteRequest = Schema.Struct({
  content: NoteContent,
  /** Older clients asked for both directions. Saving always creates the one target-language card. */
  templates: Schema.optional(Schema.Array(CardTemplate))
})
export type AddNoteRequest = typeof AddNoteRequest.Type

export const AnswerRequest = Schema.Struct({
  rating: Rating,
  durationMs: Schema.optional(Schema.Int)
})
export type AnswerRequest = typeof AnswerRequest.Type

export const AnswerResult = Schema.Struct({
  card: StudyCard,
  leech: Schema.Boolean
})
export type AnswerResult = typeof AnswerResult.Type

export const StudyStats = Schema.Struct({
  due: QueueCounts,
  reviewedToday: Schema.Int,
  streak: Schema.Int,
  notes: Schema.Int,
  cards: Schema.Int,
  unseen: Schema.Int,
  young: Schema.Int,
  mature: Schema.Int,
  /** Share of review answers in the last 30 days that weren't "again". */
  retention: Schema.NullOr(Schema.Number),
  /** Cards due on each of the next 7 study days (today first). */
  forecast: Schema.Array(Schema.Int)
})
export type StudyStats = typeof StudyStats.Type
