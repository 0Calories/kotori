import { foreignKey, integer, primaryKey, text } from "drizzle-orm/pg-core"
import { createdAt, table } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/** Claude's usage note per sense, written alongside its example sentences. */
export const senseNotes = table(
  "sense_notes",
  {
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    /** On a Japanese word, for Japanese learners, in English; null when the glosses say it all. */
    note: text(),
    /** On an English word, for English learners, in Japanese; null likewise. */
    noteJa: text(),
    model: text().notNull(),
    createdAt: createdAt()
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.sense] }),
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete("cascade")
  ]
)
