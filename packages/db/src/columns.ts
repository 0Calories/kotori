import { sql } from "drizzle-orm"
import { type AnyPgColumn, customType, pgEnum, snakeCase, text, timestamp } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"

export const { table } = snakeCase

export const timestamptz = () => timestamp({ withTimezone: true, precision: 3 })

export const createdAt = () => timestamptz().notNull().defaultNow()

/** Byte-ordered text so prefix range scans stay correct and indexable regardless of server locale. */
export const bytewiseText = customType<{ data: string }>({
  dataType: () => `text COLLATE "C"`
})

/** Stored as NULL when empty (`nullIfEmpty` / `emptyIfNull`) because an empty Postgres `text[]` still costs 16 bytes. */
export const textList = () => text().array()

export const nullIfEmpty = <T = string>(values: ReadonlyArray<T>): Array<T> | null =>
  values.length === 0 ? null : [...values]

export const emptyIfNull = <T = string>(values: ReadonlyArray<T> | null): ReadonlyArray<T> => values ?? []

/**
 * Falls back to `'simple'` when `'english'` strips every token as a stopword ("it is what it is"),
 * uses `nullif` so `'english'` runs once, and keeps outer parentheses required by expression indexes.
 */
export const englishDocument = (column: AnyPgColumn) =>
  sql`(coalesce(nullif(to_tsvector('english', ${column}), ''::tsvector), to_tsvector('simple', ${column})))`

export const language = pgEnum("language", ["en", "ja"])

export const formality = pgEnum("formality", ["vulgar", "casual", "neutral", "polite", "formal"])

export const Language = Schema.Literals(language.enumValues)
export type Language = typeof Language.Type

export const Formality = Schema.Literals(formality.enumValues)
export type Formality = typeof Formality.Type

export const source = pgEnum("source", ["jmdict", "jawiktionary", "enwiktionary", "tatoeba", "kotori", "user"])

export const Source = Schema.Literals(source.enumValues)
export type Source = typeof Source.Type
