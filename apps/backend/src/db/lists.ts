import { entries, forms, senses } from "@kotori/db"
import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { type DatabaseShape, rawRows } from "./Database.ts"

/** The tables whose lists the import writes NULL when empty (`textList`), and those lists. */
const tables = [
  {
    name: "senses",
    table: senses,
    entryId: senses.entryId,
    lists: [
      senses.pos,
      senses.misc,
      senses.fields,
      senses.dialects,
      senses.info,
      senses.stagk,
      senses.stagr,
      senses.xrefs,
      senses.antonyms
    ]
  },
  { name: "forms", table: forms, entryId: forms.entryId, lists: [forms.tags, forms.priorities, forms.restrictions] }
] as const

export interface NullEmptyListsOptions {
  /** Entries per `UPDATE`. */
  readonly batch: number
  /** Batches between vacuums, which make the space the replaced rows held reusable by the next. */
  readonly vacuumEvery: number
  readonly onProgress?: (progress: {
    readonly table: string
    readonly entries: number
    readonly rows: number
  }) => Effect.Effect<void>
}

/**
 * Rewrites the empty lists that rows written before `textList` still hold (`'{}'`, 16 bytes
 * each) as NULL, entry by entry in batches. An `UPDATE` writes a new copy of each row it
 * changes, so the table would grow by every row it rewrites; vacuuming every few batches
 * frees the old copies for the next batches to fill, and keeps the growth to about that many
 * batches' rows. The files keep their size: `VACUUM FULL` is what hands the space back.
 * Resumable, as it only touches rows that still have an empty list. Returns how many rows of
 * each table it rewrote.
 */
export const nullEmptyLists = Effect.fn("storage.nullEmptyLists")(function* (
  db: DatabaseShape,
  options: NullEmptyListsOptions
) {
  const rewritten: Record<string, number> = {}
  for (const { name, table, entryId, lists } of tables) {
    const set = sql.join(
      lists.map((list: AnyPgColumn) => sql`${sql.identifier(list.name)} = nullif(${list}, '{}')`),
      sql`, `
    )
    const anyEmpty = sql.join(
      lists.map((list: AnyPgColumn) => sql`${list} = '{}'`),
      sql` OR `
    )
    let after = -1
    let batches = 0
    let total = 0
    let done = 0
    const vacuum = Effect.gen(function* () {
      yield* db.execute(sql`VACUUM ${table}`)
      if (options.onProgress) yield* options.onProgress({ table: name, entries: done, rows: total })
    })
    while (true) {
      const [range] = yield* rawRows<{ first: number | null; last: number | null; count: number }>(
        db,
        sql`SELECT min(id) AS first, max(id) AS last, count(*)::int AS count FROM (
          SELECT ${entries.id} AS id FROM ${entries} WHERE ${entries.id} > ${after} ORDER BY ${entries.id} LIMIT ${options.batch}
        ) AS batch`
      )
      if (range?.first == null || range.last == null) break
      const [changed] = yield* rawRows<{ rows: number }>(
        db,
        sql`WITH changed AS (
          UPDATE ${table} SET ${set}
          WHERE ${entryId} BETWEEN ${range.first} AND ${range.last} AND (${anyEmpty})
          RETURNING 1
        ) SELECT count(*)::int AS rows FROM changed`
      )
      total += changed?.rows ?? 0
      done += range.count
      after = range.last
      if (++batches % options.vacuumEvery === 0) yield* vacuum
    }
    yield* vacuum
    rewritten[name] = total
  }
  return rewritten
}, Effect.orDie)
