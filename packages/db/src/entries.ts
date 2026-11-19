import { sql } from "drizzle-orm"
import { type AnyPgColumn, boolean, index, integer, pgEnum, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { language, source, table } from "./columns.ts"

export const EntryId = Schema.Int.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

/** Above JMDict's `ent_seq` range (at most 9,999,999) so Japanese and English share one integer ID space. */
export const FIRST_ENGLISH_ID = 100_000_000

export const FIRST_APPROVED_JA_ID = 200_000_000

/** Uses literal bounds rather than parameters so the planner matches `glosses_document`'s partial-index predicate. */
export const isJapaneseEntryId = (entryId: AnyPgColumn) =>
  sql`(${entryId} < ${sql.raw(String(FIRST_ENGLISH_ID))} OR ${entryId} >= ${sql.raw(String(FIRST_APPROVED_JA_ID))})`

export const entryReview = pgEnum("entry_review", ["unreviewed", "approved", "discarded"])

export const EntryReview = Schema.Literals(entryReview.enumValues)
export type EntryReview = typeof EntryReview.Type

export const REVIEW_RULES = {
  unreviewed: { inDictionary: false, searchable: true, saveable: true },
  approved: { inDictionary: true, searchable: true, saveable: true },
  discarded: { inDictionary: false, searchable: false, saveable: false }
} as const satisfies Record<
  EntryReview,
  {
    readonly inDictionary: boolean
    readonly searchable: boolean
    readonly saveable: boolean
  }
>

export type ReviewRule = keyof (typeof REVIEW_RULES)[EntryReview]

export const reviewsWhere = (rule: ReviewRule): Array<EntryReview> =>
  entryReview.enumValues.filter((review) => REVIEW_RULES[review][rule])

export const entries = table(
  "entries",
  {
    id: integer().primaryKey().$type<EntryId>(),
    language: language().notNull().default("ja"),
    source: source().notNull(),
    headword: text().notNull(),
    reading: text().notNull(),
    common: boolean().notNull().default(false),
    priority: integer().notNull().default(0),
    review: entryReview().notNull().default("approved")
  },
  (t) => [
    index("entries_priority").on(t.language, t.priority.desc(), t.id),
    index("entries_drafts")
      .on(t.id)
      .where(sql`${t.review} <> 'approved'`)
  ]
)
