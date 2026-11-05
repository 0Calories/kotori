import { sql } from "drizzle-orm"
import { type AnyPgColumn, boolean, index, integer, pgEnum, primaryKey, text } from "drizzle-orm/pg-core"
import { bytewiseText, englishDocument, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/**
 * Declared in display order: an enum sorts by declaration, so `ORDER BY kind` puts kanji
 * before kana. English words have spellings (the headword first) and inflections.
 */
export const formKind = pgEnum("form_kind", ["kanji", "kana", "spelling", "inflection"])

// The English lookups' partial indexes hold only English forms. A query reaches one only with a
// condition the planner can see implies the index's, so both are written with these, in literals
// rather than bound parameters.

/** Spellings and inflections: the English dictionary's forms; Japanese words have kanji and kana. */
export const isEnglishForm = (kind: AnyPgColumn) => sql`${kind} IN ('spelling', 'inflection')`

/** Spellings: what English full-text and fuzzy search look through; inflections are only matched whole. */
export const isSpelling = (kind: AnyPgColumn) => sql`${kind} = 'spelling'`

export const forms = table(
  "forms",
  {
    entryId: integer()
      .$type<EntryId>()
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
    index("forms_folded")
      .on(sql`lower(${t.text})`)
      .where(isEnglishForm(t.kind)),
    // English phrases match by stemmed words, and by spelling for typos. Five in six forms are
    // Japanese, which neither search reads, so these index spellings only.
    index("forms_document").using("gin", englishDocument(t.text)).where(isSpelling(t.kind)),
    index("forms_trgm").using("gin", t.text.op("gin_trgm_ops")).where(isSpelling(t.kind))
  ]
)
