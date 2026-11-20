import { EntryId } from "@kotori/contracts"
import { Console, Effect, type Layer } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import { entriesByPriority } from "../features/dictionary/index.ts"
import { ENRICHMENT_KINDS, Enrichers } from "../features/enrichment/Enrichers.ts"
import { wipeEnrichment } from "../features/enrichment/index.ts"

const entryIdsFlag = Flag.Int("entry").pipe(
  Flag.withDescription("Target specific entry id(s); repeat --entry to target multiple"),
  Flag.between(0, Number.MAX_SAFE_INTEGER)
)

const run = Command.make(
  "run",
  {
    kind: Argument.Literals("kind", ENRICHMENT_KINDS).pipe(
      Argument.withDescription("examples (Claude) or audio (ElevenLabs headword pronunciations)")
    ),
    entry: entryIdsFlag,
    dictionary: Flag.Literals("dictionary", ["all", "jmdict", "english"]).pipe(
      Flag.withDescription("Japanese words (JMDict), English words, or both, by how often they're used"),
      Flag.withDefault("all")
    ),
    limit: Flag.Int("limit").pipe(Flag.withDescription("How many entries to process"), Flag.withDefault(100)),
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withDescription("Entries processed in parallel"),
      Flag.withDefault(4)
    ),
    commonOnly: Flag.Boolean("common-only").pipe(
      Flag.withDescription("Only common entries: those JMDict marks, and the most used English words"),
      Flag.withDefault(true)
    )
  },
  Effect.fn(function* ({ kind, entry, dictionary, limit, concurrency, commonOnly }) {
    const db = yield* Database
    const language = dictionary === "all" ? undefined : dictionary === "jmdict" ? ("ja" as const) : ("en" as const)
    const enrichers = yield* Enrichers
    if (!(yield* enrichers.available).includes(kind)) {
      return yield* Console.error(`No provider is configured for ${kind}. See .env.example.`)
    }

    // Explicit --entry targets or most frequent words missing this enrichment.
    const ids =
      entry.length > 0
        ? entry.map((id) => EntryId.make(id))
        : yield* entriesByPriority(db, { limit, missing: kind, commonOnly, language })
    yield* Console.log(`Enriching ${ids.length} entries with ${kind}…`)

    let done = 0
    let failed = 0
    yield* Effect.forEach(
      ids,
      (id) =>
        enrichers.run(kind, id).pipe(
          Effect.tap((summary) => Effect.logInfo(`${id}: ${summary}`)),
          Effect.tap(() => Effect.sync(() => done++)),
          Effect.catchCause((cause) =>
            Effect.logWarning(`${id} failed`, cause).pipe(Effect.tap(() => Effect.sync(() => failed++)))
          )
        ),
      { concurrency, discard: true }
    )

    yield* Console.log(`Done: ${done} enriched, ${failed} failed.`)
  })
).pipe(Command.withDescription("Run example-sentence or pronunciation-audio enrichment manually"))

const wipe = Command.make(
  "wipe",
  {
    entry: entryIdsFlag
  },
  Effect.fn(function* ({ entry }) {
    const db = yield* Database
    const ids = entry.length > 0 ? entry.map((id) => EntryId.make(id)) : undefined
    const summary = yield* wipeEnrichment(db, ids)
    const scope = ids === undefined ? "all entries" : `${ids.length} targeted entries`
    yield* Console.log(
      `Wiped AI enrichment for ${scope}: ` +
        `${summary.examples} examples, ` +
        `${summary.seededCastingCleared} seeded example castings cleared, ` +
        `${summary.cautions} cautions, ` +
        `${summary.labels} labels, ` +
        `${summary.usagePatterns} usage patterns, ` +
        `${summary.loanLinksDeleted} loan links deleted, ` +
        `${summary.loanVerdictsCleared} loan verdicts cleared.`
    )
  })
).pipe(
  Command.withDescription(
    "Clear all AI enrichment (or for targeted --entry ids) without touching Source facts or spoken Form audio"
  )
)

/**
 * `kotori enrich`. `wipe` needs only the database; `run` also needs the AI providers (`runServices`).
 */
export const enrichCommand = <E, R>(runServices: Layer.Layer<Enrichers, E, R>) =>
  Command.make("enrich").pipe(
    Command.withDescription("Run enrichment manually on targeted entries or wipe AI enrichment across the dictionary"),
    Command.withSubcommands([run.pipe(Command.provide(runServices)), wipe])
  )
