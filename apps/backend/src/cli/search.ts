import { Console, Effect } from "effect"
import { Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import { rebuildEntrySearch } from "../features/dictionary/index.ts"

const rebuild = Command.make(
  "rebuild",
  {
    batchSize: Flag.Int("batch-size").pipe(Flag.withDescription("Entries projected per batch"), Flag.withDefault(1000))
  },
  Effect.fn(function* ({ batchSize }) {
    const db = yield* Database
    const started = Date.now()
    const summary = yield* rebuildEntrySearch(db, { batchSize })
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    yield* Console.log(
      `Rebuilt entry_search for ${summary.entries.toLocaleString()} entries (${summary.indexedRows.toLocaleString()} rows) in ${seconds}s.`
    )
  })
).pipe(
  Command.withDescription(
    "Drop and rebuild the entry_search projection purely from entries.base without touching entries.enrichment"
  )
)

export const searchCommand = Command.make("search").pipe(
  Command.withDescription("Manage the derived entry_search projection"),
  Command.withSubcommands([rebuild])
)
