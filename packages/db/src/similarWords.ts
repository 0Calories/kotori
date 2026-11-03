import { doublePrecision, foreignKey, integer, pgEnum, primaryKey } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const difference = pgEnum("difference", [
  "more_casual",
  "more_formal",
  "more_literary",
  "more_colloquial",
  "respectful",
  "humble",
  "more_specific",
  "more_general",
  "different_feeling",
  "different_usage"
])

export const similarWords = table(
  "similar_words",
  {
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    similarId: integer()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    similarity: doublePrecision().notNull(),
    difference: difference().notNull(),
    confidence: doublePrecision().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.sense, t.similarId] }),
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete("cascade")
  ]
)
