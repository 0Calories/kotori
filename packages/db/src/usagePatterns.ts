import { sql } from "drizzle-orm"
import { foreignKey, index, integer, text } from "drizzle-orm/pg-core"
import { source, table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const usagePatterns = table(
  "usage_patterns",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    position: integer().notNull(),
    text: text().notNull(),
    source: source().notNull(),
    aboutEntryId: integer()
      .$type<EntryId>()
      .references(() => entries.id, { onDelete: "set null" })
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("usage_patterns_sense").on(t.entryId, t.sense, t.position),
    index("usage_patterns_about")
      .on(t.aboutEntryId)
      .where(sql`${t.aboutEntryId} IS NOT NULL`)
  ]
)
