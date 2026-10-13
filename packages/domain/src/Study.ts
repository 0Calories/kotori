import * as Schema from "effect/Schema"
import { Register } from "./Coach.ts"
import { EntryId } from "./Dictionary.ts"

export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

export const CardId = Schema.String.pipe(Schema.brand("CardId"))
export type CardId = typeof CardId.Type

export const Rating = Schema.Literals(["again", "hard", "good", "easy"])
export type Rating = typeof Rating.Type

export const CardQueue = Schema.Literals(["new", "learning", "review", "relearning"])
export type CardQueue = typeof CardQueue.Type

/** recognize: see the target language, recall the meaning. produce: see the meaning, say it. */
export const CardTemplate = Schema.Literals(["recognize", "produce"])
export type CardTemplate = typeof CardTemplate.Type

export const SavedExample = Schema.Struct({
  ja: Schema.String,
  furigana: Schema.String,
  en: Schema.String,
  audioUrl: Schema.NullOr(Schema.String)
})
export type SavedExample = typeof SavedExample.Type

export const WordNote = Schema.Struct({
  kind: Schema.Literal("word"),
  entryId: EntryId,
  senseIndex: Schema.Int,
  headword: Schema.String,
  reading: Schema.String,
  meaning: Schema.String,
  /** A short nuance hint shown on production cards, e.g. "casual, spoken". */
  hint: Schema.NullOr(Schema.String),
  example: Schema.NullOr(SavedExample),
  audioUrl: Schema.NullOr(Schema.String)
})
export type WordNote = typeof WordNote.Type

export const PhraseNote = Schema.Struct({
  kind: Schema.Literal("phrase"),
  /** The phrase in the target language. */
  text: Schema.String,
  furigana: Schema.NullOr(Schema.String),
  /** What it means or when to use it, in the learner's native language. */
  meaning: Schema.String,
  note: Schema.NullOr(Schema.String),
  register: Schema.NullOr(Register),
  source: Schema.Literals(["how-to-say", "naturalness", "manual"])
})
export type PhraseNote = typeof PhraseNote.Type

export const NoteContent = Schema.Union([WordNote, PhraseNote])
export type NoteContent = typeof NoteContent.Type

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
