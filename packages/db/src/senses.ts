import { boolean, integer, primaryKey, text } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"
import { entries } from "./entries.ts"

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
