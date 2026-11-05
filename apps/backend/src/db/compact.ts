import { entries, forms, glosses, senses } from "@kotori/db"
import { getTableName, type SQL, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import type { DatabaseShape } from "./Database.ts"

/** The tables re-imports bloat: they replace forms and glosses wholesale and upsert entries and senses. */
export const DICTIONARY_TABLES: ReadonlyArray<PgTable> = [entries, senses, glosses, forms]

const rowsOf = <A>(db: DatabaseShape, statement: SQL) =>
  db.execute(statement).pipe(Effect.map((result) => (result as { readonly rows: ReadonlyArray<A> }).rows))

/** This database's size and a table's with its indexes and TOAST, in bytes. */
const sizes = (db: DatabaseShape, table: PgTable) =>
  rowsOf<{ database: string; table: string }>(
    db,
    sql`SELECT pg_database_size(current_database())::text AS database, pg_total_relation_size(${getTableName(table)}::regclass)::text AS table`
  ).pipe(Effect.map(([row]) => ({ database: Number(row?.database ?? 0), table: Number(row?.table ?? 0) })))

export interface CompactOptions {
  /** The most the database may hold, in bytes: Neon Free's 1 GB, less what other branches of the project take. */
  readonly cap: number
  /** Room to leave under the cap for everything else writing meanwhile. */
  readonly reserve: number
  /** Report what would be compacted without compacting. */
  readonly dryRun: boolean
  readonly onStep?: (step: CompactStep) => Effect.Effect<void>
}

export interface CompactStep {
  readonly table: string
  /** The database's size before the step. */
  readonly database: number
  /** The table's size, indexes and TOAST included, before and after. */
  readonly before: number
  readonly after: number
  readonly compacted: boolean
  /** Whether its size fit under the cap; the first that doesn't ends a real run. */
  readonly fits: boolean
}

/**
 * Compacts the dictionary's tables with `VACUUM (FULL, ANALYZE)`, one at a time, smallest first.
 * Each writes a fresh copy of its table and indexes while the old one stays until it is done,
 * so it needs free room of up to the table's current size, and it frees the old one's dead and
 * empty space when it finishes, which makes room for the next. A table runs only when its
 * size fits between the database's size and the cap less the reserve; the first that doesn't
 * stops the run. Each holds an exclusive lock on its table while it runs (seconds for these),
 * so searches wait meanwhile. `VACUUM` can't run in a transaction, so each is a statement of its own.
 */
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
