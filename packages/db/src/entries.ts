import { boolean, index, integer, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { language, table } from "./columns.ts"

/** JMDict's `ent_seq` for Japanese words; English words are numbered from 100,000,000. */
export const EntryId = Schema.Int.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

export const entries = table(
  "entries",
  {
    /** JMDict's `ent_seq`; English entries are numbered from 100,000,000 (see packages/eiwa). */
    id: integer().primaryKey().$type<EntryId>(),
    /** The headword's language: Japanese for JMDict, English for the English dictionary. */
    language: language().notNull().default("ja"),
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
