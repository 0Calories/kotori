import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { Database } from "../db/Database.ts"
import { countOf, entriesByPriority } from "../features/dictionary/index.ts"
import { Enrichers } from "../features/enrichment/Enrichers.ts"
import { jobCounts } from "../features/enrichment/index.ts"

export const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const db = yield* Database
    for (const [name, language] of [
      ["JMDict", "ja"],
      ["English", "en"]
    ] as const) {
      const ids = (missing?: "nuance" | "examples" | "audio") =>
        entriesByPriority(db, { limit: 1_000_000, missing, commonOnly: true, language }).pipe(
          Effect.map((found) => found.length)
        )
      const common = yield* ids()
      yield* Console.log(
        `${name}: ${(yield* countOf(db, language)).toLocaleString()} entries (${common.toLocaleString()} common)`
      )
      for (const kind of ["nuance", "examples", "audio"] as const) {
        yield* Console.log(
          `  ${kind.padEnd(9)} ${(common - (yield* ids(kind))).toLocaleString()} / ${common.toLocaleString()} common entries`
        )
      }
    }
    yield* Console.log(`Providers: ${(yield* (yield* Enrichers).available).join(", ") || "none configured"}`)
    for (const row of yield* jobCounts(db)) {
      yield* Console.log(`  jobs ${row.kind}/${row.status}: ${row.n}`)
    }
  })
).pipe(Command.withDescription("Show dictionary and enrichment coverage"))
