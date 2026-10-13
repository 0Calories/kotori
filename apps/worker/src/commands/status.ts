import { DictionaryRepo, JobsRepo } from "@kotori/db"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { Enrichers } from "../Enrichers.ts"

export const status = Command.make(
  "status",
  {},
  Effect.fn(function*() {
    const dictionary = yield* DictionaryRepo
    const missing = (kind: "nuance" | "examples" | "audio") =>
      dictionary.entriesByPriority({ limit: 1_000_000, missing: kind, commonOnly: true }).pipe(Effect.map((ids) => ids.length))
    const common = (yield* dictionary.entriesByPriority({ limit: 1_000_000, commonOnly: true })).length

    yield* Console.log(`Dictionary: ${(yield* dictionary.count).toLocaleString()} entries (${common.toLocaleString()} common)`)
    for (const kind of ["nuance", "examples", "audio"] as const) {
      yield* Console.log(`  ${kind.padEnd(9)} ${(common - (yield* missing(kind))).toLocaleString()} / ${common.toLocaleString()} common entries`)
    }
    yield* Console.log(`Providers: ${(yield* (yield* Enrichers).available).join(", ") || "none configured"}`)
    for (const row of yield* (yield* JobsRepo).counts) {
      yield* Console.log(`  jobs ${row.kind}/${row.status}: ${row.n}`)
    }
  })
).pipe(Command.withDescription("Show dictionary and enrichment coverage"))
