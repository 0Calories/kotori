import { Enrichment } from "@kotori/services"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

export const enrich = Command.make(
  "enrich",
  {
    kind: Argument.Literals("kind", ["nuance", "examples", "audio"]).pipe(
      Argument.withDescription("nuance (Jev), examples (Claude) or audio (ElevenLabs)")
    ),
    entry: Flag.Int("entry").pipe(Flag.withDescription("Enrich one entry by JMDict id"), Flag.optional),
    limit: Flag.Int("limit").pipe(Flag.withDescription("How many entries to process"), Flag.withDefault(100)),
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withDescription("Entries processed in parallel"),
      Flag.withDefault(4)
    ),
    commonOnly: Flag.Boolean("common-only").pipe(
      Flag.withDescription("Only entries JMDict marks as common"),
      Flag.withDefault(true)
    )
  },
  Effect.fn(function* ({ kind, entry, limit, concurrency, commonOnly }) {
    if (!(yield* Enrichment.available).includes(kind)) {
      return yield* Console.error(`No provider is configured for ${kind}. See .env.example.`)
    }

    // Most frequent words first, skipping anything already enriched, so runs can be resumed.
    const ids = Option.isSome(entry) ? [entry.value] : yield* Enrichment.backlog(kind, { limit, commonOnly })
    yield* Console.log(`Enriching ${ids.length} entries with ${kind}…`)

    let done = 0
    let failed = 0
    yield* Effect.forEach(
      ids,
      (id) =>
        Enrichment.run(kind, id).pipe(
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
