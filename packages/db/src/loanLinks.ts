import { sql } from "drizzle-orm"
import { check, index, integer, pgEnum, text, unique } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

export const loanMeaning = pgEnum("loan_meaning", ["true_loanword", "wasei_eigo"])

export const LoanLinkMeaning = Schema.Literals(loanMeaning.enumValues)
export type LoanLinkMeaning = typeof LoanLinkMeaning.Type

export const loanLinks = table(
  "loan_links",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    katakana: text().notNull(),
    katakanaEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    english: text().notNull(),
    englishEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" }),
    meaning: loanMeaning(),
    source: source().notNull(),
    meaningSource: source()
  },
  (t) => [
    unique("loan_links_pair").on(t.katakana, t.english),
    check("loan_links_meaning_source", sql`(${t.meaning} IS NULL) = (${t.meaningSource} IS NULL)`),
    index("loan_links_katakana_entry").on(t.katakanaEntryId),
    index("loan_links_english_entry").on(t.englishEntryId)
  ]
)
