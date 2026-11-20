import { entries, forms, senses } from "@kotori/db"
import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { Effect } from "effect"
import { type DatabaseShape, rawRows } from "./Database.ts"

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
  readonly batch: number
  readonly vacuumEvery: number
  readonly onProgress?: (progress: {
    readonly table: string
    readonly entries: number
    readonly rows: number
  }) => Effect.Effect<void>
}

// Postgres UPDATE writes new tuple versions, so VACUUM periodically to reuse dead space instead of bloating the table across the full rewrite.
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
