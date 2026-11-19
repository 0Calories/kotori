import { foreignKey, index, integer, text } from "drizzle-orm/pg-core"
import { englishDocument, table } from "./columns.ts"
import { type EntryId, isJapaneseEntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const glosses = table(
  "glosses",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    position: integer().notNull(),
    text: text().notNull(),
    type: text(),
    norm: text().notNull()
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("glosses_sense").on(t.entryId, t.sense),
    index("glosses_norm").on(t.norm),
    // Only Japanese entries have English glosses to stem; `glosses_trgm` serves both English fuzzy search and Japanese `LIKE '%…%'`.
    index("glosses_document").using("gin", englishDocument(t.text)).where(isJapaneseEntryId(t.entryId)),
    index("glosses_trgm").using("gin", t.norm.op("gin_trgm_ops"))
  ]
)
