import { foreignKey, index, integer, text } from "drizzle-orm/pg-core"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

/**
 * How a sense is used: the dictionary's own notes (JMDict's `s_inf`, the English dictionary's
 * `info`: "usu. to one's subordinate", "usu. in the negative") and context Kotori adds beside
 * them, told apart by `source`. In the learner's language.
 */
export const patterns = table(
  "patterns",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    position: integer().notNull(),
    text: text().notNull(),
    source: source().notNull(),
    /** A word the note compares with (ご苦労様 → お疲れ様), when it names one. */
    aboutEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" })
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("patterns_sense").on(t.entryId, t.sense, t.position)
  ]
)
