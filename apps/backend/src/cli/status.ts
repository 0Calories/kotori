import { Clock, Config, Console, Effect } from "effect"
import { Command } from "effect/cli"
import { Database } from "../db/Database.ts"
import { AUDIO_BUDGET_WINDOW, audioCharactersSince, DEFAULT_AUDIO_MONTHLY_CHARS } from "../features/audio/index.ts"
import { countOf, entriesByPriority } from "../features/dictionary/index.ts"
import { Enrichers } from "../features/enrichment/Enrichers.ts"
import { jobCounts } from "../features/enrichment/index.ts"

export const ENRICHMENTS = ["nuance", "examples", "audio"] as const
export type Enrichment = (typeof ENRICHMENTS)[number]

/** One dictionary's size, and how many of its common entries each enrichment has reached. */
export interface DictionaryCoverage {
  readonly name: string
  readonly language: "ja" | "en"
  readonly entries: number
  readonly common: number
  readonly enriched: Readonly<Record<Enrichment, number>>
}

/** What `kotori status` reports: coverage, the audio budget, the providers and the job queue. */
export interface Coverage {
  readonly dictionaries: ReadonlyArray<DictionaryCoverage>
  readonly audio: { readonly used: number; readonly budget: number }
  readonly providers: ReadonlyArray<string>
  readonly jobs: ReadonlyArray<{ readonly kind: string; readonly status: string; readonly n: number }>
}

export const coverage = Effect.gen(function* () {
  const db = yield* Database
  const dictionaries: Array<DictionaryCoverage> = []
  for (const [name, language] of [
    ["JMDict", "ja"],
    ["English", "en"]
  ] as const) {
    const ids = (missing?: Enrichment) =>
      entriesByPriority(db, { limit: 1_000_000, missing, commonOnly: true, language }).pipe(
        Effect.map((found) => found.length)
      )
    const common = yield* ids()
    const enriched = { nuance: 0, examples: 0, audio: 0 }
    for (const kind of ENRICHMENTS) enriched[kind] = common - (yield* ids(kind))
    dictionaries.push({ name, language, entries: yield* countOf(db, language), common, enriched })
  }
  const budget = yield* Config.Int("KOTORI_AUDIO_MONTHLY_CHARS").pipe(Config.withDefault(DEFAULT_AUDIO_MONTHLY_CHARS))
  const used = yield* audioCharactersSince(db, new Date((yield* Clock.currentTimeMillis) - AUDIO_BUDGET_WINDOW))
  const report: Coverage = {
    dictionaries,
    audio: { used, budget },
    providers: yield* (yield* Enrichers).available,
    jobs: yield* jobCounts(db)
  }
  return report
})

export const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const report = yield* coverage
    for (const dictionary of report.dictionaries) {
      yield* Console.log(
        `${dictionary.name}: ${dictionary.entries.toLocaleString()} entries (${dictionary.common.toLocaleString()} common)`
      )
      for (const kind of ENRICHMENTS) {
        yield* Console.log(
          `  ${kind.padEnd(9)} ${dictionary.enriched[kind].toLocaleString()} / ${dictionary.common.toLocaleString()} common entries`
        )
      }
    }
    yield* Console.log(
      `Audio (30d): ${report.audio.used.toLocaleString()} / ${report.audio.budget.toLocaleString()} characters`
    )
    yield* Console.log(`Providers: ${report.providers.join(", ") || "none configured"}`)
    for (const row of report.jobs) {
      yield* Console.log(`  jobs ${row.kind}/${row.status}: ${row.n}`)
    }
  })
).pipe(Command.withDescription("Show dictionary and enrichment coverage"))
