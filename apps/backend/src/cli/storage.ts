import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import { nullEmptyLists } from "../db/lists.ts"

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
        .join(", ")} now store NULL for their empty lists. VACUUM FULL returns the space.`
    )
  })
).pipe(
  Command.withDescription(
    "Rewrite the empty lists that senses and forms rows imported before still store as '{}' as NULL, in vacuumed batches"
  )
)

export const storage = Command.make("storage").pipe(
  Command.withDescription("Keep the database small: rewrite rows into leaner storage"),
  Command.withSubcommands([lists])
)
