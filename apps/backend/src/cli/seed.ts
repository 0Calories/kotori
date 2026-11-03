import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import * as Eiwa from "../features/dictionary/import/eiwa/Eiwa.ts"
import * as JMDict from "../features/dictionary/import/jmdict/JMDict.ts"
import { countOf, entryCount } from "../features/dictionary/index.ts"

export const seed = Command.make(
  "seed",
  {
    dictionary: Flag.Literals("dictionary", ["all", "jmdict", "english"]).pipe(
      Flag.withDescription(
        "Which dictionary to import: JMDict (Japanese words, for English speakers), the English one (for Japanese speakers), or both"
      ),
      Flag.withDefault("all")
    ),
    file: Flag.String("file").pipe(
      Flag.withDescription("Import a local JMdict file (.gz or .xml) instead of downloading the latest"),
      Flag.optional
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Stop after this many entries in each dictionary"),
      Flag.optional
    ),
    commonOnly: Flag.Boolean("common-only").pipe(
      Flag.withDescription("Only import common words: the ~22k JMDict marks, the ~10k most used English ones"),
      Flag.withDefault(false)
    ),
    ifEmpty: Flag.Boolean("if-empty").pipe(
      Flag.withDescription("Skip a dictionary that already has entries (for setup scripts)"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ dictionary: which, file, limit, commonOnly, ifEmpty }) {
    const db = yield* Database
    const seconds = (started: number) => ((Date.now() - started) / 1000).toFixed(1)

    if (which !== "english") {
      const existing = yield* countOf(db, "ja")
      if (ifEmpty && existing > 0) {
        yield* Console.log(`JMDict already has ${existing.toLocaleString()} entries.`)
      } else {
        const jmdictFile = Option.getOrUndefined(file) ?? (yield* JMDict.download("data/jmdict"))
        const started = Date.now()
        const result = yield* JMDict.importFile({ file: jmdictFile, limit: Option.getOrUndefined(limit), commonOnly })
        yield* Console.log(`Imported ${result.entries.toLocaleString()} JMDict entries in ${seconds(started)}s.`)
      }
    }

    if (which !== "jmdict") {
      const existing = yield* countOf(db, "en")
      if (ifEmpty && existing > 0) {
        yield* Console.log(`The English dictionary already has ${existing.toLocaleString()} words.`)
      } else {
        const files = yield* Eiwa.download("data/eiwa")
        const started = Date.now()
        const result = yield* Eiwa.importFiles({
          files,
          limit: Option.getOrUndefined(limit),
          commonOnly
        })
        yield* Console.log(
          `Imported ${result.entries.toLocaleString()} English words in ${seconds(started)}s` +
            (result.removed > 0 ? `, and removed ${result.removed.toLocaleString()} it no longer has.` : ".")
        )
      }
    }
    yield* Console.log(`The dictionary has ${(yield* entryCount(db)).toLocaleString()} entries.`)
  })
).pipe(
  Command.withDescription(
    "Download JMDict and load JMDict and the consolidated English dictionary into the database"
  )
)
