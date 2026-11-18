import { sql } from "drizzle-orm"
import { boolean, doublePrecision, index, integer, jsonb, pgEnum, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, Language, retentionStage, table, timestamptz } from "./columns.ts"
import { entries, EntryId } from "./entries.ts"
import { type UserId, users } from "./users.ts"

/** How formal a phrase from the coach sounds; the coach never offers a vulgar one. */
export const Register = Schema.Literals(["casual", "neutral", "polite", "formal"])
export type Register = typeof Register.Type

export const SavedExample = Schema.Struct({
  ja: Schema.String,
  furigana: Schema.String,
  en: Schema.String,
  audioUrl: Schema.NullOr(Schema.String),
  /** The English sentence, spoken; absent on notes saved before English was voiced. */
  translationAudioUrl: Schema.optional(Schema.NullOr(Schema.String))
})
export type SavedExample = typeof SavedExample.Type

export const WordNote = Schema.Struct({
  kind: Schema.Literal("word"),
  entryId: EntryId,
  senseIndex: Schema.Int,
  /** The headword's language; absent on notes saved before the English dictionary, all of them Japanese words. */
  language: Schema.optional(Language),
  headword: Schema.String,
  reading: Schema.String,
  /** The glosses of the saved sense, in the other language from the headword. */
  meaning: Schema.String,
  /** A short usage hint shown in reviews: the sense's labels, worded, e.g. "Casual · Masculine". */
  hint: Schema.NullOr(Schema.String),
  /** How the sense is used, shown with the answer; absent on notes saved before it existed. */
  note: Schema.optional(Schema.NullOr(Schema.String)),
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

export const noteKind = pgEnum("note_kind", ["word", "phrase"])

/** A saved note's id. */
export const NoteId = Schema.String.pipe(Schema.brand("NoteId"))
export type NoteId = typeof NoteId.Type

/**
 * Something a learner saved to study: a dictionary sense, or a phrase from the Coach or typed by
 * hand, with its place in the review schedule.
 */
export const notes = table(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom().$type<NoteId>(),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: noteKind().notNull(),
    /** What is shown in reviews, frozen at save time so later enrichment changes don't rewrite a learner's note. */
    content: jsonb().$type<NoteContent>().notNull(),
    /** For word notes, the dictionary sense they came from. */
    entryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    sense: integer(),
    retentionStage: retentionStage().notNull().default("new"),
    due: timestamptz().notNull(),
    /** Days between reviews once the note graduates. */
    interval: integer().notNull().default(0),
    ease: doublePrecision().notNull().default(0),
    /** Position in the learning steps while in `learning` or `relearning`. */
    step: integer().notNull().default(0),
    reps: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    leech: boolean().notNull().default(false),
    lastReview: timestamptz(),
    /** Random tie-breaker so due notes don't always come in the same order. */
    seed: integer().notNull(),
    /** Order new notes are introduced in. */
    position: integer().notNull(),
    createdAt: createdAt()
  },
  (t) => [
    index("notes_user").on(t.userId, t.createdAt),
    index("notes_due").on(t.userId, t.retentionStage, t.due),
    uniqueIndex("notes_word")
      .on(t.userId, t.entryId, t.sense)
      .where(sql`${t.entryId} IS NOT NULL`)
  ]
)
