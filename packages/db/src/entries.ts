import { sql } from "drizzle-orm"
import { type AnyPgColumn, boolean, index, integer, pgEnum, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { language, source, table } from "./columns.ts"

/** JMDict's `ent_seq` for Japanese words; English words are numbered from 100,000,000. */
export const EntryId = Schema.Int.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

/** English entries are numbered from here up, well above JMDict's sequence numbers (at most 9,999,999). */
export const FIRST_ENGLISH_ID = 100_000_000

/** Japanese entries approved out of Ask Kotori are numbered from here up, past the English block. */
export const FIRST_APPROVED_JA_ID = 200_000_000

/**
 * Whether an entry id is a Japanese word's, by its number: outside the English block. Glosses
 * carry no language, so their full-text index (`glosses_document`) covers Japanese words' glosses
 * this way, and a query reaches it by writing this same condition. The numbers are literals,
 * never bound parameters, so the planner can see that the query's condition is the index's.
 */
export const isJapaneseEntryId = (entryId: AnyPgColumn) =>
  sql`(${entryId} < ${sql.raw(String(FIRST_ENGLISH_ID))} OR ${entryId} >= ${sql.raw(String(FIRST_APPROVED_JA_ID))})`

/**
 * Whether the admin has accepted an entry into the dictionary. Every imported entry is `approved`;
 * an entry Kotori drafted in Ask Kotori starts `unreviewed` (shown marked unverified, ranked below
 * approved words) until the admin approves it or `discarded` it. A discarded entry stays, hidden
 * from search, as a negative cache and for learners who saved it (see ADR 0002).
 */
export const entryReview = pgEnum("entry_review", ["unreviewed", "approved", "discarded"])

export const EntryReview = Schema.Literals(entryReview.enumValues)
export type EntryReview = typeof EntryReview.Type

/**
 * What each review state lets an entry do. Every read that treats the states differently asks this
 * table, so a new state is given its meaning here or fails to compile.
 */
export const REVIEW_RULES = {
  unreviewed: { inDictionary: false, searchable: true, saveable: true },
  approved: { inDictionary: true, searchable: true, saveable: true },
  discarded: { inDictionary: false, searchable: false, saveable: false }
} as const satisfies Record<
  EntryReview,
  {
    /**
     * Part of the dictionary proper: counted, linked to, kept or removed by re-imports, and
     * enriched with examples and audio.
     */
    readonly inDictionary: boolean
    /** Found by search and by Ask Kotori's check for a word it already has; a draft shown marked unverified. */
    readonly searchable: boolean
    /** A learner can save it to a new note. A note saved before keeps it, whatever its state. */
    readonly saveable: boolean
  }
>

export type ReviewRule = keyof (typeof REVIEW_RULES)[EntryReview]

/** The review states whose entries `rule` holds for. */
export const reviewsWhere = (rule: ReviewRule): Array<EntryReview> =>
  entryReview.enumValues.filter((review) => REVIEW_RULES[review][rule])

export const entries = table(
  "entries",
  {
    /** JMDict's `ent_seq`; English entries from `FIRST_ENGLISH_ID`, approved Japanese ones from `FIRST_APPROVED_JA_ID`. */
    id: integer().primaryKey().$type<EntryId>(),
    /** The headword's language: Japanese for JMDict, English for the English dictionary. */
    language: language().notNull().default("ja"),
    /**
     * Where the entry and its senses came from: JMDict, English or Japanese Wiktionary, or Kotori
     * for words approved out of Ask Kotori. Labels and usage patterns read from the senses carry it
     * as their source.
     */
    source: source().notNull(),
    headword: text().notNull(),
    /** Kana for Japanese words; IPA for English ones, or empty when the sources have none. */
    reading: text().notNull(),
    /** Carries one of JMDict's "common" markers (news1, ichi1, spec1, gai1), or is a frequent English word. */
    common: boolean().notNull().default(false),
    /** How often the word is used, folded into one number, so search and enrichment can favour words people use. */
    priority: integer().notNull().default(0),
    review: entryReview().notNull().default("approved")
  },
  (t) => [
    index("entries_priority").on(t.language, t.priority.desc(), t.id),
    // Kotori's drafts, few, so reads that leave them out need not join every entry.
    index("entries_drafts")
      .on(t.id)
      .where(sql`${t.review} <> 'approved'`)
  ]
)
