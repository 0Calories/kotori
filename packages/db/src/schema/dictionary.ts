import type { SQL } from "drizzle-orm"
import { boolean, foreignKey, index, integer, pgEnum, primaryKey, text } from "drizzle-orm/pg-core"
import { bytewiseText, englishDocument, table, tsvector } from "./columns.ts"

// The dictionary is seeded from JMDict and read everywhere. Entries are JMDict's own
// units; forms, senses and glosses are ordered children with a `position`. The seeder
// upserts entries and senses and replaces forms and glosses, so enrichment survives a reseed.

/** Declared in display order: an enum sorts by declaration, so `ORDER BY kind` puts kanji before kana. */
export const formKind = pgEnum("form_kind", ["kanji", "kana"])

export const entries = table(
  "entries",
  {
    /** JMDict's `ent_seq`. */
    id: integer().primaryKey(),
    headword: text().notNull(),
    reading: text().notNull(),
    /** Carries one of JMDict's "common" markers (news1, ichi1, spec1, gai1). */
    common: boolean().notNull().default(false),
    /** JMDict's frequency markers folded into one number, so search and enrichment can favour words people use. */
    priority: integer().notNull().default(0)
  },
  (t) => [index("entries_priority").on(t.priority.desc(), t.id)]
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
    /** JMDict `ke_inf` / `re_inf` codes, e.g. "rK" (rarely-used kanji), "sk" (search-only). */
    tags: text().array().notNull().default([]),
    /** JMDict priority markers: news1, ichi1, spec1, gai1, nf01… */
    priorities: text().array().notNull().default([]),
    /** For kana forms: the kanji forms this reading belongs to; empty means all. */
    restrictions: text().array().notNull().default([]),
    noKanji: boolean().notNull().default(false)
  },
  (t) => [primaryKey({ columns: [t.entryId, t.kind, t.position] }), index("forms_text").on(t.text)]
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
    antonyms: text().array().notNull().default([]),
    /** The English words a loanword sense comes from, where JMDict names them (`lsource`): マンション ← mansion. */
    sources: text().array().notNull().default([]),
    /** JMDict's wasei-eigo (和製英語) mark: English-looking, coined in Japan. */
    wasei: boolean().notNull().default(false)
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
    /** `normalizeGloss(text)`: "to eat (a meal)" -> "eat", for exact EN->JP lookup and finding words that share a meaning. */
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
