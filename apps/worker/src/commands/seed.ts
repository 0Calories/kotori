import { resolveFromRoot } from "@kotori/db"
import { JMDict } from "@kotori/jmdict"
import { Dictionary } from "@kotori/services"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"

export const seed = Command.make(
  "seed",
  {
    file: Flag.String("file").pipe(
      Flag.withDescription("Import a local JMdict file (.gz or .xml) instead of downloading the latest"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(Flag.withDescription("Stop after this many entries"), Flag.optional),
    commonOnly: Flag.Boolean("common-only").pipe(
      Flag.withDescription("Only import the ~22k entries JMDict marks as common"),
      Flag.withDefault(false)
    ),
    ifEmpty: Flag.Boolean("if-empty").pipe(
      Flag.withDescription("Do nothing if the dictionary already has entries (for setup scripts)"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ file, limit, commonOnly, ifEmpty }) {
    if (ifEmpty) {
      const existing = yield* Dictionary.count
      if (existing > 0) return yield* Console.log(`The dictionary already has ${existing.toLocaleString()} entries.`)
    }
    const path = Option.isSome(file)
      ? resolveFromRoot(file.value)
      : yield* JMDict.download(resolveFromRoot("data/jmdict"))
    const started = Date.now()
    const result = yield* Dictionary.importFile({ file: path, limit: Option.getOrUndefined(limit), commonOnly })
    const total = yield* Dictionary.count
    yield* Console.log(
      `Imported ${result.entries.toLocaleString()} entries in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
        `(${total.toLocaleString()} in the dictionary).`
    )
  })
).pipe(Command.withDescription("Download JMDict from EDRDG and load it into the database"))
