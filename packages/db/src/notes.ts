import { sql } from "drizzle-orm"
import { index, integer, jsonb, pgEnum, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, Language, table } from "./columns.ts"
import { entries, EntryId } from "./entries.ts"
import { type UserId, users } from "./users.ts"

/** Speech register used across the coach features. */
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
  /** A short hint shown on production cards: the sense's labels, worded, e.g. "Casual · Masculine". */
  hint: Schema.NullOr(Schema.String),
  /** The sense's usage note, shown on the card back; absent on notes saved before it existed. */
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

/** Something a learner saved to study: a dictionary sense, or a phrase from the coach or typed by hand. */
export const notes = table(
  "notes",
  {
    id: uuid().primaryKey().defaultRandom().$type<NoteId>(),
    userId: uuid()
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: noteKind().notNull(),
    /** What is shown on the cards, frozen at save time so later enrichment changes don't rewrite a learner's card. */
    content: jsonb().$type<NoteContent>().notNull(),
    /** For word notes, the dictionary sense they came from. */
    entryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    sense: integer(),
    createdAt: createdAt()
  },
  (t) => [
    index("notes_user").on(t.userId, t.createdAt),
    uniqueIndex("notes_word")
      .on(t.userId, t.entryId, t.sense)
      .where(sql`${t.entryId} IS NOT NULL`)
  ]
)
