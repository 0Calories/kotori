import { DictionaryRepo, JobsRepo } from "@kotori/db"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"
import { Enrichers } from "../Enrichers.ts"

export const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const dictionary = yield* DictionaryRepo
    for (const [name, language] of [
      ["JMDict", "ja"],
      ["English", "en"]
    ] as const) {
      const ids = (missing?: "nuance" | "examples" | "audio") =>
        dictionary
          .entriesByPriority({ limit: 1_000_000, missing, commonOnly: true, language })
          .pipe(Effect.map((found) => found.length))
      const common = yield* ids()
      yield* Console.log(
        `${name}: ${(yield* dictionary.countOf(language)).toLocaleString()} entries (${common.toLocaleString()} common)`
      )
      for (const kind of ["nuance", "examples", "audio"] as const) {
        yield* Console.log(
          `  ${kind.padEnd(9)} ${(common - (yield* ids(kind))).toLocaleString()} / ${common.toLocaleString()} common entries`
        )
      }
    }
    yield* Console.log(`Providers: ${(yield* (yield* Enrichers).available).join(", ") || "none configured"}`)
    for (const row of yield* (yield* JobsRepo).counts) {
      yield* Console.log(`  jobs ${row.kind}/${row.status}: ${row.n}`)
    }
  })
).pipe(Command.withDescription("Show dictionary and enrichment coverage"))
