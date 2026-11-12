import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, pgEnum, smallint, text, unique } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/**
 * What would surprise a learner. The kinds differ by direction: Japanese learners meet
 * politeness pitfalls, English learners meet katakana wasei-eigo; `confusable` and
 * `collocation` meet both. Grammar facts (countability) are labels.
 */
export const cautionKind = pgEnum("caution_kind", [
  // Learning Japanese
  "rude_upward",
  "keigo_direction",
  "set_phrase",
  "particle_pattern",
  "gendered_speech",
  // Learning English
  "wasei_eigo",
  "textbook_english",
  "directness",
  "variety",
  // Both
  "confusable",
  "collocation"
])

export const CautionKind = Schema.Literals(cautionKind.enumValues)
export type CautionKind = typeof CautionKind.Type

/**
 * The kinds that can surprise a learner of each language: a caution on a Japanese word is for a
 * Japanese learner, one on an English word for an English learner. Wasei-eigo is a katakana
 * expression misleading an English learner, so it is never on a Japanese word; a rude-upward
 * caution is Japanese politeness, never on an English one.
 */
export const CAUTION_KINDS: Readonly<Record<"ja" | "en", ReadonlyArray<CautionKind>>> = {
  ja: [
    "rude_upward",
    "keigo_direction",
    "set_phrase",
    "particle_pattern",
    "gendered_speech",
    "confusable",
    "collocation"
  ],
  en: ["wasei_eigo", "textbook_english", "directness", "variety", "confusable", "collocation"]
}

/** A word carries at most this many cautions; `rank` runs from 1 to it. */
export const MAX_CAUTIONS = 3

/**
 * One short teaching where a learner would be surprised, written only when the labels don't
 * already say it (てめえ's `derog` needs none). Scoped to a sense (抱く's hug sense) or, with
 * `sense` null, to the word. The text is in the learner's language: English on a Japanese word,
 * Japanese on an English one; it names a sense by its gloss, never its number.
 */
export const cautions = table(
  "cautions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    /** The sense it is about; null for the whole word. */
    sense: integer(),
    /** Display order, 1 first; unique per word, so the cap is the database's to keep. */
    rank: smallint().notNull(),
    kind: cautionKind().notNull(),
    text: text().notNull(),
    /** The word to compare with or not to confuse it with, when there is one. */
    aboutEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    source: source().notNull()
  },
  (t) => [
    unique("cautions_rank").on(t.entryId, t.rank),
    check("cautions_rank_range", sql`${t.rank} BETWEEN 1 AND ${sql.raw(String(MAX_CAUTIONS))}`),
    // A word-level caution's null sense skips the check (MATCH SIMPLE).
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    // Deleting an entry clears the cautions that compare with it.
    index("cautions_about")
      .on(t.aboutEntryId)
      .where(sql`${t.aboutEntryId} IS NOT NULL`)
  ]
)
