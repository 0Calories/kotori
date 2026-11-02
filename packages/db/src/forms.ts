import { sql } from "drizzle-orm"
import { boolean, index, integer, pgEnum, primaryKey, text } from "drizzle-orm/pg-core"
import { bytewiseText, table } from "./columns.ts"
import { entries } from "./entries.ts"

/**
 * Declared in display order: an enum sorts by declaration, so `ORDER BY kind` puts kanji
 * before kana. English words have spellings (the headword first) and inflections.
 */
export const formKind = pgEnum("form_kind", ["kanji", "kana", "spelling", "inflection"])

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
