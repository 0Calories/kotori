import { boolean, integer, jsonb, primaryKey } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { table, textList } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/**
 * The language (ISO 639-2B code from JMDict's `lsource`, e.g. `"eng"`, `"fre"`) and original word
 * a loanword or wasei-eigo sense came from: French `"jupon"` for ズボン, English `"convenience store"`
 * for コンビニ. `word` is null when JMDict names only the language.
 */
export const SenseOrigin = Schema.Struct({
  language: Schema.String,
  word: Schema.NullOr(Schema.String)
})
export type SenseOrigin = typeof SenseOrigin.Type

/** Its lists (`textList`) and `origins` are NULL when empty. */
export const senses = table(
  "senses",
  {
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    /** Part-of-speech codes, resolved to names through `tags`. */
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
    /** The languages and words a loanword sense came from, where JMDict names them (`lsource`). */
    origins: jsonb().$type<ReadonlyArray<SenseOrigin>>(),
    /** JMDict's wasei-eigo (和製英語) mark: English-looking, coined in Japan. */
    wasei: boolean().notNull().default(false)
  },
  (t) => [primaryKey({ columns: [t.entryId, t.position] })]
)
