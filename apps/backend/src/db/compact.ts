import { entries, forms, glosses, senses } from "@kotori/db"
import { getTableName, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { type DatabaseShape, rawRows } from "./Database.ts"

export const DICTIONARY_TABLES: ReadonlyArray<PgTable> = [entries, senses, glosses, forms]

const sizes = (db: DatabaseShape, table: PgTable) =>
  rawRows<{ database: string; table: string }>(
    db,
    sql`SELECT pg_database_size(current_database())::text AS database, pg_total_relation_size(${getTableName(table)}::regclass)::text AS table`
  ).pipe(Effect.map(([row]) => ({ database: Number(row?.database ?? 0), table: Number(row?.table ?? 0) })))

export interface CompactOptions {
  readonly cap: number
  readonly reserve: number
  readonly dryRun: boolean
  readonly onStep?: (step: CompactStep) => Effect.Effect<void>
}

export interface CompactStep {
  readonly table: string
  readonly database: number
  readonly before: number
  readonly after: number
  readonly compacted: boolean
  readonly fits: boolean
}

// VACUUM FULL rewrites a full copy before freeing dead pages and cannot run in a transaction, so compact smallest-first only while a copy fits under the cap.
export const compactTables = Effect.fn("storage.compactTables")(function* (db: DatabaseShape, options: CompactOptions) {
  const steps: Array<CompactStep> = []
  const remaining = [...DICTIONARY_TABLES]
  while (remaining.length > 0) {
    const measured = yield* Effect.forEach(remaining, (relation) =>
      Effect.map(sizes(db, relation), ({ database, table }) => ({ relation, database, size: table }))
    )
    const next = measured.reduce((smallest, candidate) => (candidate.size < smallest.size ? candidate : smallest))
    remaining.splice(remaining.indexOf(next.relation), 1)
    const fits = next.database + next.size <= options.cap - options.reserve
    const compacted = fits && !options.dryRun
    if (compacted) yield* db.execute(sql`VACUUM (FULL, ANALYZE) ${next.relation}`)
    const step: CompactStep = {
      table: getTableName(next.relation),
      database: next.database,
      before: next.size,
      after: compacted ? (yield* sizes(db, next.relation)).table : next.size,
      compacted,
      fits
    }
    steps.push(step)
    if (options.onStep) yield* options.onStep(step)
    if (!fits && !options.dryRun) break
  }
  return steps
}, Effect.orDie)
