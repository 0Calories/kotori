import { DictionaryRepo, EnrichmentRepo } from "@kotori/db"
import { ENGLISH_QUESTIONS_VERSION, NuanceEnricher, QUESTIONS_VERSION } from "@kotori/nuance"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Enrichers } from "../Enrichers.ts"

export const enrich = Command.make(
  "enrich",
  {
    kind: Argument.Literals("kind", ["nuance", "examples", "audio"]).pipe(
      Argument.withDescription("nuance (Jev), examples (Claude) or audio (ElevenLabs)")
    ),
    entry: Flag.Int("entry").pipe(Flag.withDescription("Enrich one entry by id"), Flag.optional),
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
    ),
    outdated: Flag.Boolean("outdated").pipe(
      Flag.withDescription(
        "Nuance only: re-judge entries whose stored nuance predates their language's current question set, instead of entries missing it"
      ),
      Flag.withDefault(false)
    ),
    reinterpret: Flag.Boolean("reinterpret").pipe(
      Flag.withDescription(
        "Nuance only: re-derive every stored judgment, and English words' loan verdicts, from their saved answers, without calling Jev. Ignores --limit and --common-only; honours --entry and --dictionary."
      ),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ kind, entry, dictionary, limit, concurrency, commonOnly, outdated, reinterpret }) {
    const language = dictionary === "all" ? undefined : dictionary === "jmdict" ? ("ja" as const) : ("en" as const)
    if (reinterpret) {
      if (kind !== "nuance") return yield* Console.error("--reinterpret only applies to nuance.")
      const nuance = yield* NuanceEnricher
      const ids = Option.isSome(entry) ? [entry.value] : yield* (yield* EnrichmentRepo).nuanceEntryIds(language)
      yield* Console.log(`Reinterpreting stored nuance for ${ids.length} entries…`)
      let senses = 0
      let failed = 0
      yield* Effect.forEach(
        ids,
        (id) =>
          nuance.reinterpret(id).pipe(
            Effect.tap((summary) => Effect.sync(() => (senses += summary.senses))),
            Effect.catchCause((cause) =>
              Effect.logWarning(`${id} failed`, cause).pipe(Effect.tap(() => Effect.sync(() => failed++)))
            )
          ),
        { concurrency, discard: true }
      )
      return yield* Console.log(`Done: ${senses} senses reinterpreted, ${failed} entries failed.`)
    }

    const enrichers = yield* Enrichers
    if (!(yield* enrichers.available).includes(kind)) {
      return yield* Console.error(`No provider is configured for ${kind}. See .env.example.`)
    }

    if (outdated && kind !== "nuance") return yield* Console.error("--outdated only applies to nuance.")

    // Most frequent words first, skipping anything already enriched, so runs can be resumed.
    const ids = Option.isSome(entry)
      ? [entry.value]
      : outdated
        ? yield* (yield* EnrichmentRepo).outdatedNuanceEntryIds(
            { ja: QUESTIONS_VERSION, en: ENGLISH_QUESTIONS_VERSION },
            { commonOnly, limit, language }
          )
        : yield* (yield* DictionaryRepo).entriesByPriority({ limit, missing: kind, commonOnly, language })
    yield* Console.log(`Enriching ${ids.length} entries with ${kind}${outdated ? " (outdated)" : ""}…`)

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
).pipe(Command.withDescription("Backfill nuance, example sentences or audio, most common words first"))
