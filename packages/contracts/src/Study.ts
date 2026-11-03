import {
  CardId,
  cardQueue,
  cards,
  cardTemplate,
  NoteContent,
  NoteId,
  notes,
  PhraseNote,
  rating,
  SavedExample,
  UserId,
  WordNote
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export { CardId, NoteContent, NoteId, PhraseNote, SavedExample, WordNote }

export const Rating = createSelectSchema(rating)
export type Rating = typeof Rating.Type

export const CardQueue = createSelectSchema(cardQueue)
export type CardQueue = typeof CardQueue.Type

/**
 * recognize: show the word in the target language and ask for the meaning.
 * produce: the retired reverse direction. The column's enum still has the value; a migration
 * deleted those cards and their review logs, and new notes are not given one.
 */
export const CardTemplate = createSelectSchema(cardTemplate)
export type CardTemplate = typeof CardTemplate.Type

const Card = createSelectSchema(cards, { id: CardId, noteId: NoteId, userId: UserId })
const NoteRow = createSelectSchema(notes, { id: NoteId, userId: UserId, content: NoteContent })

export const CardSummary = Schema.Struct(
  Struct.pick(Card.fields, ["id", "template", "queue", "due", "interval", "leech"])
)
export type CardSummary = typeof CardSummary.Type

export const Note = Schema.Struct({
  ...Struct.pick(NoteRow.fields, ["id", "content", "createdAt"]),
  cards: Schema.Array(CardSummary)
})
export type Note = typeof Note.Type

export const StudyCard = Schema.Struct({
  ...Struct.pick(Card.fields, [
    "id",
    "noteId",
    "template",
    "queue",
    "due",
    "interval",
    "ease",
    "reps",
    "lapses",
    "leech"
  ]),
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
  nextDue: Schema.NullOr(Card.fields.due)
})
export type ReviewQueue = typeof ReviewQueue.Type

/** Saving creates the one target-language card. */
export const AddNoteRequest = Schema.Struct({ content: NoteContent })
export type AddNoteRequest = typeof AddNoteRequest.Type

export const AnswerRequest = Schema.Struct({
  rating: Rating,
  /** How long the learner took to answer, when the client measured it. */
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
