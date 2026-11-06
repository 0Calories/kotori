import { index, integer, pgEnum, text, unique } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/** Whether a katakana loan means what its English word means (アドバイス) or has drifted (マンション). */
export const loanMeaning = pgEnum("loan_meaning", ["same", "divergent"])

export const LoanLinkMeaning = Schema.Literals(loanMeaning.enumValues)
export type LoanLinkMeaning = typeof LoanLinkMeaning.Type

/**
 * A katakana word and the English word it was borrowed from: one fact, stored once and read from
 * both entries. JMDict's `lsource` names most pairs; Kotori judges the rest, and whether the
 * meaning drifted. The words are kept as text so a link survives either entry being absent.
 */
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
    /** Null until a source says; JMDict names the pair but not whether the meaning drifted. */
    meaning: loanMeaning(),
    source: source().notNull()
  },
  (t) => [
    unique("loan_links_pair").on(t.katakana, t.english),
    index("loan_links_katakana_entry").on(t.katakanaEntryId),
    index("loan_links_english_entry").on(t.englishEntryId)
  ]
)
