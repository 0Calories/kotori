import { foreignKey, index, integer, jsonb, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, formality, source, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/** Who would plausibly say an example sentence: "unspecified" when nothing in it suggests one. */
export const SpeakerGender = Schema.Literals(["masculine", "feminine", "unspecified"])
export type SpeakerGender = typeof SpeakerGender.Type

export const SpeakerAge = Schema.Literals(["child", "youth", "adult", "middle-aged", "older", "unspecified"])
export type SpeakerAge = typeof SpeakerAge.Type

/** Conversation (someone talking to someone), announcement (news, notices, mail read aloud) or narration (prose). */
export const SentenceMedium = Schema.Literals(["conversation", "announcement", "narration"])
export type SentenceMedium = typeof SentenceMedium.Type

/** The dominant feel of the delivery; "humorous" sends a sentence to a comic voice, the rest is kept for voice settings. */
export const SentenceTone = Schema.Literals(["neutral", "cheerful", "serious", "gentle", "rough", "humorous"])
export type SentenceTone = typeof SentenceTone.Type

/**
 * Who would say an example sentence, and how: what voice casting reads beside its formality, and
 * nothing else does. Claude judges it when it writes a sentence; Jev judges a seeded one's when
 * its word is voiced. A medium or tone too unsure to steer casting is null.
 */
export const Casting = Schema.Struct({
  speakerGender: SpeakerGender,
  speakerAge: SpeakerAge,
  medium: Schema.NullOr(SentenceMedium),
  /** Regional variety label such as "kansai" or "british"; null for the language's default. */
  variety: Schema.NullOr(Schema.String),
  tone: Schema.NullOr(SentenceTone)
})
export type Casting = typeof Casting.Type

export const examples = table(
  "examples",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    position: integer().notNull(),
    ja: text().notNull(),
    /** The Japanese sentence with `{base|reading}` furigana. */
    furigana: text().notNull(),
    en: text().notNull(),
    /**
     * How formal the sentence sounds, which casts its voice. Claude judges it as it writes;
     * sentences seeded from Tatoeba or Wiktionary, whose sources don't say, are null until Jev
     * judges them on the way to being voiced. Never a default: a guessed register would cast the
     * wrong voice, so a sentence without one is not voiced.
     */
    formality: formality(),
    note: text(),
    /** The usage note for English learners, in Japanese; null on sentences written before it. */
    noteJa: text(),
    /**
     * The speaker signals voice casting reads; null on sentences written before casting, and on
     * seeded ones no run has judged yet. A seeded sentence Jev judged but gave no formality has
     * one (all unspecified) beside a null formality: judged and declined, so it isn't asked again.
     */
    casting: jsonb().$type<Casting>(),
    /** Where the sentence came from: Kotori wrote it, or it was seeded from Tatoeba or Wiktionary. */
    source: source().notNull().default("kotori"),
    /** The model that wrote it; null on seeded sentences. */
    model: text(),
    createdAt: createdAt()
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("examples_sense").on(t.entryId, t.sense, t.position)
  ]
)
