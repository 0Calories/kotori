import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, pgEnum, smallint, text, unique } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/**
 * What would surprise a learner. The kinds differ by direction: English speakers learning
 * Japanese meet politeness traps, Japanese speakers learning English meet katakana false
 * friends; `confusable`, `collocation` and `tone` meet both. `tone` is how heavy or light a word
 * lands (ぴえん is playful, never real grief; "hate" is stronger than 嫌い), which no other kind
 * says. Grammar facts (countability) are labels.
 */
export const pitfallKind = pgEnum("pitfall_kind", [
  // Learning Japanese
  "rude_upward",
  "keigo_direction",
  "set_phrase",
  "particle_pattern",
  "gendered_speech",
  // Learning English
  "false_friend",
  "textbook_english",
  "directness",
  "variety",
  // Both
  "confusable",
  "collocation",
  "tone"
])

export const PitfallKind = Schema.Literals(pitfallKind.enumValues)
export type PitfallKind = typeof PitfallKind.Type

/**
 * The kinds that can surprise a learner of each language: a pitfall on a Japanese word is for an
 * English speaker learning Japanese, one on an English word for a Japanese speaker learning
 * English. A false friend is a katakana loan misleading a Japanese speaker, so it is never on a
 * Japanese word; a rude-upward trap is Japanese politeness, never on an English one.
 */
export const PITFALL_KINDS: Readonly<Record<"ja" | "en", ReadonlyArray<PitfallKind>>> = {
  ja: [
    "rude_upward",
    "keigo_direction",
    "set_phrase",
    "particle_pattern",
    "gendered_speech",
    "confusable",
    "collocation",
    "tone"
  ],
  en: ["false_friend", "textbook_english", "directness", "variety", "confusable", "collocation", "tone"]
}

/** A word carries at most this many pitfalls; `rank` runs from 1 to it. */
export const MAX_PITFALLS = 3

/**
 * One short teaching where a learner would be surprised, written only when the labels don't
 * already say it (てめえ's `derog` needs none). Scoped to a sense (抱く's hug sense) or, with
 * `sense` null, to the word. The text is in the learner's language: English on a Japanese word,
 * Japanese on an English one; it names a sense by its gloss, never its number.
 */
export const pitfalls = table(
  "pitfalls",
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
    kind: pitfallKind().notNull(),
    text: text().notNull(),
    /** The word to compare with or not to confuse it with, when there is one. */
    aboutEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    source: source().notNull()
  },
  (t) => [
    unique("pitfalls_rank").on(t.entryId, t.rank),
    check("pitfalls_rank_range", sql`${t.rank} BETWEEN 1 AND ${sql.raw(String(MAX_PITFALLS))}`),
    // A word-level pitfall's null sense skips the check (MATCH SIMPLE).
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    // Deleting an entry clears the pitfalls that compare with it.
    index("pitfalls_about")
      .on(t.aboutEntryId)
      .where(sql`${t.aboutEntryId} IS NOT NULL`)
  ]
)
