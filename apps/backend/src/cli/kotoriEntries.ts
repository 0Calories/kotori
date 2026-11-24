import { Console, Effect } from "effect"
import { Argument, Command } from "effect/cli"
import { Database } from "../db/Database.ts"
import { exportKotoriEntries, importKotoriEntries } from "../features/dictionary/kotoriBackup.ts"

const file = Argument.String("file").pipe(Argument.withDescription("Path to the JSONL dump file"))

const exportCommand = Command.make(
  "export",
  { file },
  Effect.fn(function* ({ file }) {
    const db = yield* Database
    const result = yield* exportKotoriEntries(db, file)
    yield* Console.log(`Exported ${result.exported.toLocaleString()} kotori: entries to ${file}.`)
  })
).pipe(Command.withDescription("Export all kotori: entries (unreviewed, approved, discarded, redirects) to JSONL"))

const importCommand = Command.make(
  "import",
  { file },
  Effect.fn(function* ({ file }) {
    const db = yield* Database
    const result = yield* importKotoriEntries(db, file)
    yield* Console.log(
      `Imported ${result.imported.toLocaleString()} kotori: entries from ${file}` +
        (result.skipped.length > 0 ? ` (skipped lines: ${result.skipped.join(", ")})` : "") +
        "."
    )
  })
).pipe(Command.withDescription("Import kotori: entries from a JSONL dump and rebuild their search projection"))

export const entriesCommand = Command.make("entries").pipe(
  Command.withDescription("Export and restore Kotori-originated (kotori:) dictionary entries"),
  Command.withSubcommands([exportCommand, importCommand])
)
