import { sql } from "drizzle-orm"
import { type AnyPgColumn, boolean, index, integer, pgEnum, primaryKey } from "drizzle-orm/pg-core"
import { bytewiseText, englishDocument, table, textList } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/** Postgres enums sort in declaration order, which `ORDER BY kind` relies on to place kanji before kana. */
export const formKind = pgEnum("form_kind", ["kanji", "kana", "spelling", "inflection"])

// Shared literal predicates so the planner can prove queries imply the partial indexes on `forms`.
export const isEnglishForm = (kind: AnyPgColumn) => sql`${kind} IN ('spelling', 'inflection')`

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
    tags: textList(),
    priorities: textList(),
    restrictions: textList(),
    noKanji: boolean().notNull().default(false)
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.kind, t.position] }),
    index("forms_text").on(t.text),
    index("forms_folded")
      .on(sql`lower(${t.text})`)
      .where(isEnglishForm(t.kind)),
    index("forms_document").using("gin", englishDocument(t.text)).where(isSpelling(t.kind)),
    index("forms_trgm").using("gin", t.text.op("gin_trgm_ops")).where(isSpelling(t.kind))
  ]
)
