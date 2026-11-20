import { boolean, integer, smallint } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

export const entryFrequency = table("entry_frequency", {
  entryId: integer()
    .$type<EntryId>()
    .primaryKey()
    .references(() => entries.id, { onDelete: "cascade" }),
  everyday: boolean().notNull().default(false),
  spokenCount: integer(),
  score: smallint()
})
