import { integer, primaryKey, text } from "drizzle-orm/pg-core"
import { audio } from "./audio.ts"
import { table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

export const entryAudio = table(
  "entry_audio",
  {
    entryId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    audioKey: text()
      .notNull()
      .references(() => audio.key)
  },
  (t) => [primaryKey({ columns: [t.entryId, t.audioKey] })]
)
