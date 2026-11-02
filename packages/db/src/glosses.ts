import { type SQL } from "drizzle-orm"
import { foreignKey, index, integer, text } from "drizzle-orm/pg-core"
import { englishDocument, table, tsvector } from "./columns.ts"
import { type EntryId } from "./entries.ts"
import { senses } from "./senses.ts"

export const glosses = table(
  "glosses",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: integer().$type<EntryId>().notNull(),
    sense: integer().notNull(),
    position: integer().notNull(),
    text: text().notNull(),
    /** JMDict gloss type: "lit", "fig", "expl", "tm", or null for an ordinary gloss. */
    type: text(),
    /**
     * The gloss as looked up, for exact lookup and finding words that share a meaning: `normalizeGloss`
     * for English ("to eat (a meal)" -> "eat"), `normalizeJapaneseGloss` for Japanese ("～を食べる。" -> "食べる").
     */
    norm: text().notNull(),
    /** Full-text index over `text`, maintained by Postgres. */
    document: tsvector()
      .notNull()
      .generatedAlwaysAs((): SQL => englishDocument(glosses.text))
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("glosses_sense").on(t.entryId, t.sense),
    index("glosses_norm").on(t.norm),
    index("glosses_document").using("gin", t.document)
  ]
)
