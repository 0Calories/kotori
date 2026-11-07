import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Database } from "../db/Database.ts"
import { ARTIFACTS, PASSES } from "../features/dictionary/passes/artifacts.ts"
import { judgeFormPass, judgeLoanPass, judgePitfallPass } from "../features/dictionary/passes/judge.ts"

const ABOUT = {
  "ja-form": "Jev: formal written Japanese words JMdict leaves untagged, as Kotori's `form` label",
  "pitfalls-ja": "Claude: pitfalls on Japanese words, for English speakers",
  "pitfalls-en": "Claude: pitfalls on English words, for Japanese speakers",
  loans: "Jev: whether English words' katakana loans kept their meaning"
} as const

/**
 * Runs one offline inference pass over the dictionary into its artifact file (`data/…`), for
 * review before it is committed. Costs inference: only run a pass whose golden eval passes
 * (`kotori eval`), and try `--dry-run` first. `kotori seed` imports the committed files.
 */
export const judge = Command.make(
  "judge",
  {
    pass: Argument.Literals("pass", PASSES).pipe(
      Argument.withDescription(PASSES.map((pass) => `${pass} (${ABOUT[pass]})`).join(", "))
    ),
    limit: Flag.Int("limit").pipe(Flag.withDescription("How many words to judge this run"), Flag.withDefault(200)),
    concurrency: Flag.Int("concurrency").pipe(Flag.withDescription("Requests in flight"), Flag.withDefault(2)),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Count and list what would be judged, without calling a model or writing the file"),
      Flag.withDefault(false)
    ),
    uncommon: Flag.Boolean("uncommon").pipe(
      Flag.withDescription("Judge every word, not only those the dictionary marks common"),
      Flag.withDefault(false)
    ),
    restart: Flag.Boolean("restart").pipe(
      Flag.withDescription("Discard a file another model or prompt version wrote, and judge every word again"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ pass, limit, concurrency, dryRun, uncommon, restart }) {
    const db = yield* Database
    const options = { limit, dryRun, concurrency, commonOnly: !uncommon, restart }
    const run = Effect.gen(function* () {
      switch (pass) {
        case "ja-form":
          return yield* judgeFormPass(db, options)
        case "loans":
          return yield* judgeLoanPass(db, options)
        case "pitfalls-ja":
        case "pitfalls-en":
          return yield* judgePitfallPass(db, pass === "pitfalls-ja" ? "ja" : "en", options)
      }
    })
    const summary = yield* run.pipe(
      Effect.catch((error) =>
        Console.error(typeof error === "string" ? error : String(error)).pipe(
          Effect.andThen(Effect.sync(() => void (process.exitCode = 1))),
          Effect.as(null)
        )
      )
    )
    if (summary === null || dryRun) return
    yield* Console.log(
      `Done: ${summary.judged} judged, ${summary.failed} failed, in ${summary.requests} requests. ` +
        `Review ${ARTIFACTS[pass]}, commit it, and re-run \`kotori seed\` to import it.`
    )
  })
).pipe(
  Command.withDescription("Run an offline inference pass over the dictionary into its data/ file (costs inference)")
)
