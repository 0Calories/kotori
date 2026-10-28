import { sql } from "drizzle-orm"
import { type AnyPgColumn, customType, snakeCase, timestamp } from "drizzle-orm/pg-core"

/** Table constructor for every table in this schema: camelCase fields, snake_case columns. */
export const { table } = snakeCase

/** A moment in time. Millisecond precision is plenty, and the services convert for the SRS code at their boundary. */
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
 * Postgres full-text document. Written only through `generatedAlwaysAs`; read in
 * queries with `@@` and `ts_rank`, never as a value.
 */
export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector"
})

/** `to_tsvector('english', column)`, for generated full-text columns. */
export const englishDocument = (column: AnyPgColumn) => sql`to_tsvector('english', ${column})`
