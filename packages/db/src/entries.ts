import { sql } from "drizzle-orm"
import { type AnyPgColumn, boolean, index, integer, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { language, source, table } from "./columns.ts"

/** JMDict's `ent_seq` for Japanese words; English words are numbered from 100,000,000. */
export const EntryId = Schema.Int.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

/** English entries are numbered from here up, well above JMDict's sequence numbers (at most 9,999,999). */
export const FIRST_ENGLISH_ID = 100_000_000

/** Japanese entries approved out of Ask Kotori are numbered from here up, past the English block. */
export const FIRST_APPROVED_JA_ID = 200_000_000

/**
 * Whether an entry id is a Japanese word's, by its number: outside the English block. Glosses
 * carry no language, so their full-text index (`glosses_document`) covers Japanese words' glosses
 * this way, and a query reaches it by writing this same condition. The numbers are literals,
 * never bound parameters, so the planner can see that the query's condition is the index's.
 */
export const isJapaneseEntryId = (entryId: AnyPgColumn) =>
  sql`(${entryId} < ${sql.raw(String(FIRST_ENGLISH_ID))} OR ${entryId} >= ${sql.raw(String(FIRST_APPROVED_JA_ID))})`

export const entries = table(
  "entries",
  {
    /** JMDict's `ent_seq`; English entries from `FIRST_ENGLISH_ID`, approved Japanese ones from `FIRST_APPROVED_JA_ID`. */
    id: integer().primaryKey().$type<EntryId>(),
    /** The headword's language: Japanese for JMDict, English for the English dictionary. */
    language: language().notNull().default("ja"),
    /**
     * Where the entry and its senses came from: JMDict, English or Japanese Wiktionary, or Kotori
     * for words approved out of Ask Kotori. Labels and usage patterns read from the senses carry it
     * as their source.
     */
    source: source().notNull(),
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
