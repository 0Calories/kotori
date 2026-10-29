import { DictionaryRepo } from "@kotori/db"
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
    )
  },
  Effect.fn(function* ({ kind, entry, dictionary, limit, concurrency, commonOnly }) {
    const enrichers = yield* Enrichers
    if (!(yield* enrichers.available).includes(kind)) {
      return yield* Console.error(`No provider is configured for ${kind}. See .env.example.`)
    }

    // Most frequent words first, skipping anything already enriched, so runs can be resumed.
    const ids = Option.isSome(entry)
      ? [entry.value]
      : yield* (yield* DictionaryRepo).entriesByPriority({
          limit,
          missing: kind,
          commonOnly,
          language: dictionary === "all" ? undefined : dictionary === "jmdict" ? "ja" : "en"
        })
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
).pipe(Command.withDescription("Backfill nuance, example sentences or audio, most common words first"))
