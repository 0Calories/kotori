import { foreignKey, index, integer, pgEnum, text } from "drizzle-orm/pg-core"
import { createdAt, formality, source, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const speakerGender = pgEnum("speaker_gender", ["masculine", "feminine", "unspecified"])

export const speakerAge = pgEnum("speaker_age", ["child", "youth", "adult", "middle-aged", "older", "unspecified"])

export const sentenceMedium = pgEnum("sentence_medium", ["conversation", "announcement", "narration"])

export const sentenceTone = pgEnum("sentence_tone", ["neutral", "cheerful", "serious", "gentle", "rough", "humorous"])

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
    formality: formality().notNull(),
    note: text(),
    /** The usage note for Japanese speakers learning English, in Japanese; null on sentences written before it. */
    noteJa: text(),
    // Casting signals, judged by the writer; null on sentences written before voice casting.
    speakerGender: speakerGender(),
    speakerAge: speakerAge(),
    medium: sentenceMedium(),
    /** Regional variety label such as "kansai" or "british"; null for the language's default. */
    variety: text(),
    tone: sentenceTone(),
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
