import { type AnyPgColumn, boolean, index, integer, jsonb, pgEnum, text } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"
import { createdAt, language, source, table, timestamptz } from "./columns.ts"
import type { EntryBase, EntryEnrichment, EntryId } from "./entryDocument.ts"

/** Review lifecycle of an entry: external entries are `approved`; Ask Kotori drafts start `unreviewed`. */
export const reviewState = pgEnum("review_state", ["approved", "unreviewed", "discarded"])
export const ReviewState = Schema.Literals(reviewState.enumValues)
export type ReviewState = typeof ReviewState.Type

/**
 * Single-table PostgreSQL document store for monolingual Japanese and English dictionary entries.
 * Deterministic Source facts live in `base` JSONB; optional Kotori AI Enrichment lives in nullable
 * `enrichment` JSONB so wiping enrichment is an instant single-column reset that never touches
 * `base` or `entry_search`.
 */
export const entries = table(
  "entries",
  {
    /** Deterministic source-prefixed identifier (`jmdict:<seq>`, `en:<headword>`, `kotori:<id>`). */
    id: text().primaryKey().$type<EntryId>(),
    /** The headword's language: Japanese (`ja`) or English (`en`). */
    language: language().notNull().default("ja"),
    /** Where the entry and its base senses came from. */
    source: source().notNull(),
    /** Lifecycle review state (`approved`, `unreviewed`, or `discarded`). */
    reviewState: reviewState().notNull().default("approved"),
    /** Canonical target entry when a duplicate `kotori:` draft is merged into another entry. */
    redirectTo: text()
      .$type<EntryId>()
      .references((): AnyPgColumn => entries.id, { onDelete: "set null" }),
    /** Carries one of JMDict's "common" markers or is a frequent English word. */
    common: boolean().notNull().default(false),
    /** How often the word is used, folded into one number for search and enrichment ordering. */
    priority: integer().notNull().default(0),
    /** Deterministic Source facts: forms, senses, glosses, usage, frequency, origins, external examples. */
    base: jsonb().$type<EntryBase>().notNull(),
    /** Optional Kotori AI Enrichment: examples, cautions, labels, usage patterns, loan verdicts. */
    enrichment: jsonb().$type<EntryEnrichment | null>(),
    createdAt: createdAt(),
    updatedAt: timestamptz().notNull().defaultNow()
  },
  (t) => [
    index("entries_priority").on(t.language, t.priority.desc(), t.id),
    index("entries_review_state").on(t.reviewState)
  ]
)
