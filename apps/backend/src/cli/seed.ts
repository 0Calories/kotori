import { DictionaryRepo, resolveFromRoot } from "@kotori/db"
import { Eiwa } from "@kotori/eiwa"
import { JMDict } from "@kotori/jmdict"
import { Console, Effect, FileSystem, Option } from "effect"
import { Command, Flag } from "effect/cli"

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
    const dictionary = yield* DictionaryRepo
    const fs = yield* FileSystem.FileSystem
    const seconds = (started: number) => ((Date.now() - started) / 1000).toFixed(1)

    // The English dictionary reads JMDict too, so the file is shared: the one given, the last
    // download, or a fresh one.
    let jmdictFile = Option.getOrUndefined(file)
    const jmdict = Effect.gen(function* () {
      if (jmdictFile !== undefined) return jmdictFile
      const previous = resolveFromRoot("data/jmdict/JMdict_e.gz")
      jmdictFile = which !== "jmdict" && (yield* fs.exists(previous)) ? previous : yield* JMDict.download("data/jmdict")
      return jmdictFile
    })

    if (which !== "english") {
      const existing = yield* dictionary.countOf("ja")
      if (ifEmpty && existing > 0) {
        yield* Console.log(`JMDict already has ${existing.toLocaleString()} entries.`)
      } else {
        jmdictFile ??= yield* JMDict.download("data/jmdict")
        const started = Date.now()
        const result = yield* JMDict.importFile({ file: jmdictFile, limit: Option.getOrUndefined(limit), commonOnly })
        yield* Console.log(`Imported ${result.entries.toLocaleString()} JMDict entries in ${seconds(started)}s.`)
      }
    }

    if (which !== "jmdict") {
      const existing = yield* dictionary.countOf("en")
      if (ifEmpty && existing > 0) {
        yield* Console.log(`The English dictionary already has ${existing.toLocaleString()} words.`)
      } else {
        const files = yield* Eiwa.download("data/eiwa")
        const started = Date.now()
        const result = yield* Eiwa.importFiles({
          files,
          jmdict: yield* jmdict,
          limit: Option.getOrUndefined(limit),
          commonOnly
        })
        yield* Console.log(
          `Imported ${result.entries.toLocaleString()} English words in ${seconds(started)}s ` +
            `(${result.wiktionary.toLocaleString()} from Wiktionary, ${result.ejdict.toLocaleString()} from EJDict, ` +
            `${result.jmdict.toLocaleString()} read backwards from JMDict)` +
            (result.removed > 0 ? `, and removed ${result.removed.toLocaleString()} it no longer has.` : ".")
        )
      }
    }
    yield* Console.log(`The dictionary has ${(yield* dictionary.count).toLocaleString()} entries.`)
  })
).pipe(
  Command.withDescription(
    "Download JMDict and the English dictionary's sources (Japanese Wiktionary, EJDict) and load them into the database"
  )
)
