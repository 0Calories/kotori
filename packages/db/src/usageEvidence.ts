import { boolean, integer, smallint } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/**
 * Deterministic evidence that a word is used, read from the seeds. It drives two chips: "Common
 * word" as reassurance and "Rarely heard today" as the surprise; nothing for the middle. No row
 * when no source speaks.
 */
export const usageEvidence = table("usage_evidence", {
  entryId: integer()
    .$type<EntryId>()
    .primaryKey()
    .references(() => entries.id, { onDelete: "cascade" }),
  /** JMDict's ichi1 list for Japanese; the top of the subtitle list for English. */
  everyday: boolean().notNull().default(false),
  /** OpenSubtitles count for English words; null for Japanese until a tokenised corpus exists. */
  spokenCount: integer(),
  /** The English dictionary's 1–5 familiarity rating, for phrases the subtitle list can't count. */
  familiarity: smallint()
})
