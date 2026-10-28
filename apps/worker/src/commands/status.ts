import { Enrichment } from "@kotori/services"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"

export const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const { entries, common, enriched } = yield* Enrichment.coverage
    yield* Console.log(`Dictionary: ${entries.toLocaleString()} entries (${common.toLocaleString()} common)`)
    for (const kind of ["nuance", "examples", "audio"] as const) {
      yield* Console.log(
        `  ${kind.padEnd(9)} ${enriched[kind].toLocaleString()} / ${common.toLocaleString()} common entries`
      )
    }
    yield* Console.log(`Providers: ${(yield* Enrichment.available).join(", ") || "none configured"}`)
    for (const row of yield* Enrichment.jobCounts) {
      yield* Console.log(`  jobs ${row.kind}/${row.status}: ${row.n}`)
    }
  })
).pipe(Command.withDescription("Show dictionary and enrichment coverage"))
