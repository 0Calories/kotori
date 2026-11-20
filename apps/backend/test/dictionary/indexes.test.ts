import { PgliteClient } from "@effect/sql-pglite"
import { assert, layer } from "@effect/vitest"
import { Data, Effect } from "effect"
import { Statement } from "effect/sql"
import { Database } from "../../src/db/Database.ts"
import {
  findFormPrefix,
  findForms,
  insertEntries,
  searchForms,
  searchFormsFuzzy,
  searchGlosses,
  searchGlossesFuzzy
} from "../../src/features/dictionary/queries.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"
import { english, entries } from "../fixtures.ts"

const lastStatement = <A, E, R>(search: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
    yield* search.pipe(
      Effect.provideService(Statement.CurrentTransformer, (statement) =>
        Effect.sync(() => {
          statements.push(statement.compile())
          return statement
        })
      )
    )
    const last = statements.at(-1)
    assert.isDefined(last)
    return last
  })

// Fail out of `withTransaction` so PGlite rolls back the dropped constraints and indexes.
class Planned extends Data.TaggedError("Planned")<{ readonly indexes: ReadonlyArray<string> }> {}

const indexesRead = <A, E, R>(search: Effect.Effect<A, E, R>, table: string, index: string) =>
  Effect.gen(function* () {
    const [query, params] = yield* lastStatement(search)
    const client = yield* PgliteClient.PgliteClient
    return yield* client
      .withTransaction(
        Effect.gen(function* () {
          // Disable scans and drop every other index so the planner must use the partial `index` if the query's predicates imply its condition.
          for (const setting of ["enable_seqscan", "enable_indexscan", "enable_indexonlyscan", "enable_nestloop"]) {
            yield* client.unsafe(`SET LOCAL ${setting} = off`)
          }
          const keys = yield* client.unsafe<{ readonly name: string }>(
            `SELECT conname AS name FROM pg_constraint WHERE conrelid = $1::regclass AND contype IN ('p', 'u')`,
            [table]
          )
          for (const key of keys) yield* client.unsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${key.name}" CASCADE`)
          const others = yield* client.unsafe<{ readonly name: string }>(
            `SELECT indexname AS name FROM pg_indexes WHERE tablename = $1 AND indexname <> $2`,
            [table, index]
          )
          for (const other of others) yield* client.unsafe(`DROP INDEX "${other.name}"`)
          const plan = yield* client.unsafe(`EXPLAIN (FORMAT JSON) ${query}`, params)
          return yield* new Planned({
            indexes: [...JSON.stringify(plan).matchAll(/"Index Name":"(\w+)"/g)].map((match) => match[1]!)
          })
        })
      )
      .pipe(Effect.catchTag("Planned", (planned) => Effect.succeed(planned.indexes)))
  })

layer(DatabaseMemory)("dictionary search indexes", (it) => {
  it.effect("English form lookups and searches can read the English forms' indexes", () =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* insertEntries(db, [...entries, ...english])
      assert.include(yield* indexesRead(findForms(db, ["Polish"], "en"), "forms", "forms_folded"), "forms_folded")
      assert.include(yield* indexesRead(findFormPrefix(db, "po", 10, "en"), "forms", "forms_folded"), "forms_folded")
      assert.include(
        yield* indexesRead(searchForms(db, ["polishing"], 10), "forms", "forms_document"),
        "forms_document"
      )
      assert.include(yield* indexesRead(searchFormsFuzzy(db, "polsh", 10), "forms", "forms_trgm"), "forms_trgm")
    })
  )

  it.effect("English gloss searches can read the indexes of Japanese words' glosses", () =>
    Effect.gen(function* () {
      const db = yield* Database
      assert.include(
        yield* indexesRead(searchGlosses(db, ["eating"], 10), "glosses", "glosses_document"),
        "glosses_document"
      )
      assert.include(
        yield* indexesRead(searchGlossesFuzzy(db, "pancak", 10), "glosses", "glosses_trgm"),
        "glosses_trgm"
      )
    })
  )
})
