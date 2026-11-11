import { sql } from "drizzle-orm"
import { type AnyPgColumn, customType, pgEnum, snakeCase, text, timestamp } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"

/** Table constructor for every table in this schema: camelCase fields, snake_case columns. */
export const { table } = snakeCase

/** A moment in time. Millisecond precision is plenty, and Study converts for the SRS code, which works in epoch milliseconds. */
export const timestamptz = () => timestamp({ withTimezone: true, precision: 3 })

/** `created_at`, set by the database when a row is inserted. */
export const createdAt = () => timestamptz().notNull().defaultNow()

/**
 * `text` in byte order. The dictionary's prefix search is a range scan
 * (`text >= prefix AND text < prefix || max char`), which is only correct and
 * only uses the index when comparisons are bytewise, whatever the server locale.
 */
export const bytewiseText = customType<{ data: string }>({
  dataType: () => `text COLLATE "C"`
})

/**
 * A list of strings, NULL when empty. An empty `text[]` still takes 16 bytes and a NULL none,
 * and most of the dictionary's lists are empty (85% of those on senses, 93% on forms), so its
 * rows store them this way: written through `nullIfEmpty`, read through `emptyIfNull`. Records
 * and the API always carry an array.
 */
export const textList = () => text().array()

export const nullIfEmpty = <T = string>(values: ReadonlyArray<T>): Array<T> | null =>
  values.length === 0 ? null : [...values]

export const emptyIfNull = <T = string>(values: ReadonlyArray<T> | null): ReadonlyArray<T> => values ?? []

/**
 * The full-text document of an English column: `to_tsvector('english', column)`, which stems
 * words and drops the commonest ones, so "eating" finds "eat out". A phrase made only of those
 * common words ("it is what it is") would have no document at all, so it is indexed word for
 * word with the `simple` configuration instead; queries made only of such words search the same
 * way (see the backend's dictionary queries).
 *
 * Nothing stores it: GIN indexes are built on this expression, and a query finds them only by
 * writing the same expression (`englishDocument(column) @@ query`), so it lives here, once. Ranking
 * computes it again for every match, so `english` runs once (a `CASE` testing its length would
 * run it twice, half again as slow). In parentheses, as an index on an expression must be.
 */
export const englishDocument = (column: AnyPgColumn) =>
  sql`(coalesce(nullif(to_tsvector('english', ${column}), ''::tsvector), to_tsvector('simple', ${column})))`

export const language = pgEnum("language", ["en", "ja"])

/** How far along a note is in being learned. */
export const retentionStage = pgEnum("retention_stage", ["new", "learning", "review", "relearning"])

export const formality = pgEnum("formality", ["vulgar", "casual", "neutral", "polite", "formal"])

/** Kotori teaches in both directions: Japanese learners and English learners. */
export const Language = Schema.Literals(language.enumValues)
export type Language = typeof Language.Type

/** How formal a word or sentence sounds, from crude to ceremonious. */
export const Formality = Schema.Literals(formality.enumValues)
export type Formality = typeof Formality.Type

/**
 * Where a dictionary fact came from: one of the seed dictionaries, Tatoeba's sentences, Kotori's
 * AI, or a user. Kotori's inference fills cells a dictionary left empty and never overwrites one.
 */
export const source = pgEnum("source", ["jmdict", "jawiktionary", "enwiktionary", "tatoeba", "kotori", "user"])

export const Source = Schema.Literals(source.enumValues)
export type Source = typeof Source.Type
