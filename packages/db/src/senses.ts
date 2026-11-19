import { boolean, integer, jsonb, primaryKey } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { table, textList } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

export const SenseOrigin = Schema.Struct({
  language: Schema.String,
  word: Schema.NullOr(Schema.String)
})
export type SenseOrigin = typeof SenseOrigin.Type

export const senses = table(
  "senses",
  {
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    pos: textList(),
    misc: textList(),
    fields: textList(),
    dialects: textList(),
    info: textList(),
    stagk: textList(),
    stagr: textList(),
    xrefs: textList(),
    antonyms: textList(),
    origins: jsonb().$type<ReadonlyArray<SenseOrigin>>(),
    wasei: boolean().notNull().default(false)
  },
  (t) => [primaryKey({ columns: [t.entryId, t.position] })]
)
