import { boolean, integer, smallint } from "drizzle-orm/pg-core"
import { table } from "./columns.ts"
import { entries, type EntryId } from "./entries.ts"

/**
 * Multi-signal frequency for an entry, synthesized from source markers, spoken counts, and curated
 * ratings rather than a single raw corpus count. It drives two chips: "Common word" as reassurance
 * and "Rarely heard today" as the surprise; nothing for the middle. No row when no source speaks.
 */
export const entryFrequency = table("entry_frequency", {
  entryId: integer()
    .$type<EntryId>()
    .primaryKey()
    .references(() => entries.id, { onDelete: "cascade" }),
  /** JMDict's ichi1 list for Japanese; the top of the subtitle list for English. */
  everyday: boolean().notNull().default(false),
  /** OpenSubtitles count for English words; null for Japanese until a tokenised corpus exists. */
  spokenCount: integer(),
  /** The 1–5 frequency score, for phrases and approved entries the subtitle list can't count. */
  score: smallint()
})
