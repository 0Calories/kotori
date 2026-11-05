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
    /** JMDict gloss type: "lit", "fig", "expl", "tm", or null for an ordinary gloss. */
    type: text(),
    /**
     * The gloss as looked up, for exact lookup and finding words that share a meaning: `normalizeGloss`
     * for English ("to eat (a meal)" -> "eat"), `normalizeJapaneseGloss` for Japanese ("～を食べる。" -> "食べる").
     */
    norm: text().notNull()
  },
  (t) => [
    foreignKey({ columns: [t.entryId, t.sense], foreignColumns: [senses.entryId, senses.position] }).onDelete(
      "cascade"
    ),
    index("glosses_sense").on(t.entryId, t.sense),
    index("glosses_norm").on(t.norm),
    // Full-text search reads the English glosses, which are Japanese words'; English words' glosses
    // are Japanese, which has no words to stem. Fuzzy search is English, but the Japanese substring
    // search (`LIKE '%…%'`) of English words' glosses uses the same trigrams, so that index has both.
    index("glosses_document").using("gin", englishDocument(t.text)).where(isJapaneseEntryId(t.entryId)),
    index("glosses_trgm").using("gin", t.norm.op("gin_trgm_ops"))
  ]
)
