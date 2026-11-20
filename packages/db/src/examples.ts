import { foreignKey, index, integer, jsonb, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, formality, source, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const SpeakerGender = Schema.Literals(["masculine", "feminine", "unspecified"])
export type SpeakerGender = typeof SpeakerGender.Type

export const SpeakerAge = Schema.Literals(["child", "youth", "adult", "middle-aged", "older", "unspecified"])
export type SpeakerAge = typeof SpeakerAge.Type

export const SentenceMedium = Schema.Literals(["conversation", "announcement", "narration"])
export type SentenceMedium = typeof SentenceMedium.Type

export const SentenceTone = Schema.Literals(["neutral", "cheerful", "serious", "gentle", "rough", "humorous"])
export type SentenceTone = typeof SentenceTone.Type

export const Casting = Schema.Struct({
  speakerGender: SpeakerGender,
  speakerAge: SpeakerAge,
  medium: Schema.NullOr(SentenceMedium),
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
    furigana: text().notNull(),
    en: text().notNull(),
    formality: formality(),
    note: text(),
    noteJa: text(),
    /** Non-null alongside a null `formality` marks a seeded sentence Jev already judged and declined, so it is not re-judged. */
    casting: jsonb().$type<Casting>(),
    source: source().notNull().default("kotori"),
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
