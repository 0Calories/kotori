import type { Language } from "@kotori/domain"
import { type SQL, sql } from "drizzle-orm"
import { boolean, foreignKey, index, integer, pgEnum, primaryKey, text } from "drizzle-orm/pg-core"
import { bytewiseText, englishDocument, table, tsvector } from "./columns.ts"

// The dictionary is read everywhere and holds two of them: JMDict's Japanese words with
// English glosses, and English words with Japanese glosses (see packages/eiwa). Entries
// are each dictionary's own units; forms, senses and glosses are ordered children with a
// `position`. The seeders upsert entries and senses and replace forms and glosses, so
// enrichment survives a reseed.

export const language = pgEnum("language", ["en", "ja"])

/**
 * Declared in display order: an enum sorts by declaration, so `ORDER BY kind` puts kanji
 * before kana. English words have spellings (the headword first) and inflections.
 */
export const formKind = pgEnum("form_kind", ["kanji", "kana", "spelling", "inflection"])

export const entries = table(
  "entries",
  {
    /** JMDict's `ent_seq`; English entries are numbered from 100,000,000 (see packages/eiwa). */
    id: integer().primaryKey(),
    /** The headword's language: Japanese for JMDict, English for the English dictionary. */
    language: language().$type<Language>().notNull().default("ja"),
    headword: text().notNull(),
    /** Kana for Japanese words; IPA for English ones, or empty when the sources have none. */
    reading: text().notNull(),
    /** Carries one of JMDict's "common" markers (news1, ichi1, spec1, gai1), or is a frequent English word. */
    common: boolean().notNull().default(false),
    /** How often the word is used, folded into one number, so search and enrichment can favour words people use. */
    priority: integer().notNull().default(0)
  },
  (t) => [index("entries_priority").on(t.language, t.priority.desc(), t.id)]
)

export const forms = table(
  "forms",
  {
    entryId: integer()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    kind: formKind().notNull(),
    position: integer().notNull(),
    text: bytewiseText().notNull(),
    common: boolean().notNull().default(false),
    /** JMDict `ke_inf` / `re_inf` codes, e.g. "rK" (rarely-used kanji), "sk" (search-only); for an inflection, what it is ("past"). */
    tags: text().array().notNull().default([]),
    /** JMDict priority markers: news1, ichi1, spec1, gai1, nf01… */
    priorities: text().array().notNull().default([]),
    /** For kana forms: the kanji forms this reading belongs to; empty means all. */
    restrictions: text().array().notNull().default([]),
    noKanji: boolean().notNull().default(false)
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.kind, t.position] }),
    index("forms_text").on(t.text),
    // English is looked up regardless of case ("polish" finds Polish); bytewise, like `text`, for prefixes.
    index("forms_folded").on(sql`lower(${t.text})`)
  ]
)

export const senses = table(
  "senses",
  {
    entryId: integer()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    /** Part-of-speech codes, resolved to labels through `tags`. */
    pos: text().array().notNull().default([]),
    misc: text().array().notNull().default([]),
    fields: text().array().notNull().default([]),
    dialects: text().array().notNull().default([]),
    info: text().array().notNull().default([]),
    /** Kanji forms this sense is restricted to (JMDict `stagk`); empty means all. */
    stagk: text().array().notNull().default([]),
    /** Kana forms this sense is restricted to (JMDict `stagr`). */
    stagr: text().array().notNull().default([]),
    xrefs: text().array().notNull().default([]),
    antonyms: text().array().notNull().default([])
  },
  (t) => [primaryKey({ columns: [t.entryId, t.position] })]
)

export const glosses = table(
  "glosses",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer().notNull(),
    sense: integer().notNull(),
    position: integer().notNull(),
    text: text().notNull(),
    /** JMDict gloss type: "lit", "fig", "expl", "tm", or null for an ordinary gloss. */
    type: text(),
    /**
     * The gloss as looked up, for exact lookup and finding words that share a meaning: `normalizeGloss`
     * for English ("to eat (a meal)" -> "eat"), `normalizeJapaneseGloss` for Japanese ("～を食べる。" -> "食べる").
     */
    norm: text().notNull(),
    /** Full-text index over `text`, maintained by Postgres. */
    document: tsvector()
      .notNull()
      .generatedAlwaysAs((): SQL => englishDocument(glosses.text))
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("glosses_sense").on(t.entryId, t.sense),
    index("glosses_norm").on(t.norm),
    index("glosses_document").using("gin", t.document)
  ]
)

/** JMDict's tag codes with their human-readable labels, for parts of speech, misc and field codes. */
export const tags = table("tags", {
  code: text().primaryKey(),
  label: text().notNull()
})
