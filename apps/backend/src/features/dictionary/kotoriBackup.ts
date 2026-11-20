import { entries, EntryBase, EntryEnrichment, EntryId, Language, ReviewState, Source } from "@kotori/db"
import { asc, eq, inArray, like, sql } from "drizzle-orm"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { type SearchProjectionSource, syncEntrySearch } from "./searchProjection.ts"

/**
 * Clean JSONL export/import format for Kotori-originated (`kotori:`) entries in PostgreSQL.
 * Replaces committed `data/approved/*.jsonl` schema-compatibility shims (ADR-0003).
 */
export const KotoriEntryDump = Schema.Struct({
  id: EntryId,
  language: Language,
  source: Source,
  reviewState: ReviewState,
  redirectTo: Schema.NullOr(EntryId),
  common: Schema.Boolean,
  priority: Schema.Int,
  base: EntryBase,
  enrichment: Schema.NullOr(EntryEnrichment)
})
export type KotoriEntryDump = typeof KotoriEntryDump.Type

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(KotoriEntryDump))
const encodeLine = Schema.encodeSync(Schema.fromJsonString(KotoriEntryDump))

export interface ExportResult {
  readonly exported: number
}

export interface ImportResult {
  readonly imported: number
  readonly skipped: ReadonlyArray<number>
}

/**
 * Exports all `kotori:` entries (`unreviewed`, `approved`, `discarded`, and merged redirects)
 * from PostgreSQL to a newline-delimited JSON file.
 */
export const exportKotoriEntries = Effect.fn("dictionary.exportKotoriEntries")(function* (
  db: DatabaseShape,
  file: string
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const rows = yield* db
    .select({
      id: entries.id,
      language: entries.language,
      source: entries.source,
      reviewState: entries.reviewState,
      redirectTo: entries.redirectTo,
      common: entries.common,
      priority: entries.priority,
      base: entries.base,
      enrichment: entries.enrichment
    })
    .from(entries)
    .where(like(entries.id, "kotori:%"))
    .orderBy(asc(entries.id))
    .pipe(Effect.orDie)

  const dir = path.dirname(file)
  if (dir.length > 0 && dir !== ".") {
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
  }
  const content = rows.map((row) => `${encodeLine(row)}\n`).join("")
  yield* fs.writeFileString(file, content).pipe(Effect.orDie)
  return { exported: rows.length } satisfies ExportResult
})

/**
 * Imports `kotori:` entries from a JSONL dump created by `exportKotoriEntries`, preserving
 * `reviewState`, `redirectTo`, `base`, and `enrichment`, and rebuilding their `entry_search`
 * projections. External (`jmdict:`, `en:`) entries are never modified.
 */
export const importKotoriEntries = Effect.fn("dictionary.importKotoriEntries")(function* (
  db: DatabaseShape,
  file: string
) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(file).pipe(Effect.orDie)
  const records: Array<KotoriEntryDump> = []
  const skipped: Array<number> = []

  let lineNumber = 0
  for (const line of text.split("\n")) {
    lineNumber++
    if (line.trim().length === 0) continue
    const decoded = decodeLine(line)
    if (Option.isNone(decoded) || !decoded.value.id.startsWith("kotori:")) {
      skipped.push(lineNumber)
      continue
    }
    records.push(decoded.value)
  }

  if (records.length === 0) return { imported: 0, skipped } satisfies ImportResult

  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const now = new Date()
        // Pass 1: upsert all rows with redirectTo = null so kotori: -> kotori: redirects never fail FK checks.
        for (const record of records) {
          yield* tx
            .insert(entries)
            .values({
              id: record.id,
              language: record.language,
              source: record.source,
              reviewState: record.reviewState,
              redirectTo: null,
              common: record.common,
              priority: record.priority,
              base: record.base,
              enrichment: record.enrichment,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: entries.id,
              set: {
                language: sql`excluded.language`,
                source: sql`excluded.source`,
                reviewState: sql`excluded.review_state`,
                redirectTo: sql`excluded.redirect_to`,
                common: sql`excluded.common`,
                priority: sql`excluded.priority`,
                base: sql`excluded.base`,
                enrichment: sql`excluded.enrichment`,
                updatedAt: sql`excluded.updated_at`
              }
            })
        }

        // Pass 2: restore redirectTo targets that exist in `entries`.
        const wantedTargets = [
          ...new Set(records.flatMap((record) => (record.redirectTo === null ? [] : [record.redirectTo])))
        ]
        const existingTargets = new Set(
          wantedTargets.length === 0
            ? []
            : (yield* tx.select({ id: entries.id }).from(entries).where(inArray(entries.id, wantedTargets))).map(
                (row) => row.id
              )
        )

        const projections: Array<SearchProjectionSource> = []
        for (const record of records) {
          const redirectTo =
            record.redirectTo !== null && existingTargets.has(record.redirectTo) ? record.redirectTo : null
          if (redirectTo !== null) {
            yield* tx.update(entries).set({ redirectTo, updatedAt: now }).where(eq(entries.id, record.id))
          }
          projections.push({
            id: record.id,
            language: record.language,
            reviewState: record.reviewState,
            redirectTo,
            common: record.common,
            priority: record.priority,
            base: record.base
          })
        }

        yield* syncEntrySearch(tx, projections)
      })
    )
    .pipe(Effect.orDie)

  return { imported: records.length, skipped } satisfies ImportResult
})
