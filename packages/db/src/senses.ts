import { boolean, integer, primaryKey } from "drizzle-orm/pg-core"
import { table, textList } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/** Its lists are NULL when empty (`textList`). */
export const senses = table(
  "senses",
  {
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    /** Part-of-speech codes, resolved to labels through `tags`. */
    pos: textList(),
    misc: textList(),
    fields: textList(),
    dialects: textList(),
    info: textList(),
    /** Kanji forms this sense is restricted to (JMDict `stagk`); empty means all. */
    stagk: textList(),
    /** Kana forms this sense is restricted to (JMDict `stagr`). */
    stagr: textList(),
    xrefs: textList(),
    antonyms: textList(),
    /** The English words a loanword sense comes from, where JMDict names them (`lsource`): マンション ← mansion. */
    sources: textList(),
    /** JMDict's wasei-eigo (和製英語) mark: English-looking, coined in Japan. */
    wasei: boolean().notNull().default(false)
  },
  (t) => [primaryKey({ columns: [t.entryId, t.position] })]
)
