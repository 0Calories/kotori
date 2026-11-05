import { NodeHttpClient } from "@effect/platform-node"
import { Config, Console, Effect, Layer } from "effect"
import { Command, Flag } from "effect/cli"
import { compactTables } from "../db/compact.ts"
import { Database } from "../db/Database.ts"
import { nullEmptyLists } from "../db/lists.ts"
import { moveClipsToBucket } from "../features/audio/move.ts"
import { Bucket } from "../integrations/storage/Bucket.ts"
import { CommandFailed } from "./failure.ts"

const MB = 1024 * 1024

const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`

const lists = Command.make(
  "lists",
  {
    batch: Flag.Int("batch").pipe(Flag.withDescription("Entries per UPDATE"), Flag.withDefault(2000)),
    vacuumEvery: Flag.Int("vacuum-every").pipe(
      Flag.withDescription("Batches between vacuums; fewer means less growth and more vacuuming"),
      Flag.withDefault(10)
    )
  },
  Effect.fn(function* ({ batch, vacuumEvery }) {
    const db = yield* Database
    const rewritten = yield* nullEmptyLists(db, {
      batch,
      vacuumEvery,
      onProgress: ({ table, entries, rows }) =>
        Console.log(`${table}: ${entries.toLocaleString()} entries done, ${rows.toLocaleString()} rows rewritten`)
    })
    yield* Console.log(
      `Done: ${Object.entries(rewritten)
        .map(([table, rows]) => `${rows.toLocaleString()} ${table} rows`)
        .join(", ")} now store NULL for their empty lists. \`kotori storage compact\` returns the space.`
    )
  })
).pipe(
  Command.withDescription(
    "Rewrite the empty lists that senses and forms rows imported before still store as '{}' as NULL, in vacuumed batches"
  )
)

/** The bucket `KOTORI_AUDIO_BUCKET` names, which `kotori storage audio` requires. */
const ConfiguredBucket = Layer.unwrap(Effect.map(Config.String("KOTORI_AUDIO_BUCKET"), Bucket.layer)).pipe(
  Layer.provide(NodeHttpClient.layerUndici)
)

const audio = Command.make(
  "audio",
  {
    batch: Flag.Int("batch").pipe(Flag.withDescription("Clips read from the table at a time"), Flag.withDefault(100)),
    concurrency: Flag.Int("concurrency").pipe(Flag.withDescription("Clips uploaded at once"), Flag.withDefault(4))
  },
  Effect.fn(function* ({ batch, concurrency }) {
    const db = yield* Database
    const bucket = yield* Bucket
    yield* Console.log(`Moving the clips in audio_files to the bucket ${bucket.name}.`)
    const result = yield* moveClipsToBucket(db, {
      batch,
      concurrency,
      onProgress: ({ moved, bytes }) => Console.log(`${moved.toLocaleString()} clips moved (${mb(bytes)})`)
    })
    yield* Console.log(`Moved ${result.moved.toLocaleString()} clips (${mb(result.bytes)}).`)
    yield* Console.log(
      result.truncated
        ? "audio_files is empty and truncated, so its space is free."
        : "audio_files still has clips; run this again."
    )
    if (result.unverified.length > 0) {
      return yield* new CommandFailed({
        message: `${result.unverified.length} clips didn't read back the same and stay in audio_files: ${result.unverified.slice(0, 10).join(", ")}`
      })
    }
  })
).pipe(
  Command.withDescription(
    "Move every clip in the audio_files table to the KOTORI_AUDIO_BUCKET bucket, checking each before deleting its row, then truncate the table"
  ),
  Command.provide(ConfiguredBucket)
)

const compact = Command.make(
  "compact",
  {
    capMb: Flag.Int("cap-mb").pipe(
      Flag.withDescription(
        "The most the database may hold: Neon Free's 1024, less what the project's other branches take"
      ),
      Flag.withDefault(1024)
    ),
    reserveMb: Flag.Int("reserve-mb").pipe(
      Flag.withDescription("Room to leave under the cap for writes meanwhile"),
      Flag.withDefault(64)
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Show the sizes and what fits, and compact nothing"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ capMb, reserveMb, dryRun }) {
    const db = yield* Database
    const steps = yield* compactTables(db, {
      cap: capMb * MB,
      reserve: reserveMb * MB,
      dryRun,
      onStep: (step) =>
        Console.log(
          step.compacted
            ? `${step.table}: ${mb(step.before)} → ${mb(step.after)} (database was ${mb(step.database)})`
            : `${step.table}: ${mb(step.before)}, database ${mb(step.database)}: ${step.fits ? "fits" : `doesn't fit under ${capMb - reserveMb} MB`}`
        )
    })
    const stopped = steps.find((step) => !step.fits)
    if (stopped !== undefined && !dryRun) {
      return yield* new CommandFailed({
        message: `Stopped at ${stopped.table}: free some space first, or raise --cap-mb if the cap allows.`
      })
    }
  })
).pipe(
  Command.withDescription(
    "VACUUM FULL the dictionary's tables one at a time, smallest first, each only if a copy of it fits under the cap; each locks its table while it runs"
  )
)

export const storage = Command.make("storage").pipe(
  Command.withDescription("Keep the database small: leaner rows, clips in the bucket, compacted tables"),
  Command.withSubcommands([lists, audio, compact])
)
