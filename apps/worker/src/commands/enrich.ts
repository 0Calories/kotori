import { DictionaryRepo, EnrichmentRepo } from "@kotori/db"
import { ENGLISH_QUESTIONS_VERSION, NuanceEnricher, QUESTIONS_VERSION } from "@kotori/nuance"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Enrichers } from "../Enrichers.ts"

/**
 * What one entry costs at its provider, roughly, so a bulk run can say what it will spend before
 * it spends it. Measured 2026-10-30 on seven English words: Jev read about 20k input tokens per
 * entry ($0.042 per million) and Claude about $0.03 per entry. ElevenLabs bills per character of
 * the plan, so audio gets a count without a price.
 */
const COST_PER_ENTRY = { nuance: 20_000 * 0.042e-6, examples: 0.03, audio: null } as const

const PROVIDER = { nuance: "Jev", examples: "Claude", audio: "ElevenLabs" } as const

/** What a bulk run would do and roughly what it would cost, said before anything is sent. */
export const bulkPlan = (kind: keyof typeof PROVIDER, entries: number) => {
  const cost = COST_PER_ENTRY[kind]
  const price = cost === null ? "billed per character" : `about $${(entries * cost).toFixed(2)}`
  return `Would enrich ${entries.toLocaleString("en-US")} entries with ${kind} (${PROVIDER[kind]}, ${price}).`
}

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
    yes: Flag.Boolean("yes").pipe(
      Flag.withDescription(
        "Spend it: a run over more than one entry shows its plan and roughly what it costs, and stops there without this"
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
  Effect.fn(function* ({ kind, entry, dictionary, limit, concurrency, commonOnly, outdated, yes, reinterpret }) {
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
    // Re-judging every entry is one mistyped --limit away, and it spends at a provider; a bulk
    // run says what it would do and waits for --yes. One entry, or a free --reinterpret, doesn't.
    if (Option.isNone(entry)) {
      yield* Console.log(bulkPlan(kind, ids.length))
      if (!yes) return yield* Console.log("Nothing was sent. Run it again with --yes to go ahead.")
    }
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
