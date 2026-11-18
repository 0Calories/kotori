import { FrequencyRater } from "@kotori/ai"
import { Console, Effect, FileSystem, Semaphore } from "effect"
import { Command, Flag } from "effect/cli"
import { chunks } from "../db/chunks.ts"
import { Database } from "../db/Database.ts"
import { FREQUENCY_FILE, parseFrequency, serializeFrequency } from "../features/dictionary/import/english/frequency.ts"
import { parseConsolidatedLine } from "../features/dictionary/import/english/words.ts"
import { headwordIds } from "../features/dictionary/queries.ts"
import { resolveFromRoot } from "../runtime/Paths.ts"

/** The curated entries, whose own ratings the import prefers, so they aren't rated again. */
const CURATED_FILE = "data/english/enwiktionary-ja.jsonl"

export const frequency = Command.make(
  "frequency",
  {
    limit: Flag.Int("limit").pipe(Flag.withDescription("How many unrated phrases to rate"), Flag.withDefault(500)),
    batch: Flag.Int("batch").pipe(Flag.withDescription("Phrases per Claude request"), Flag.withDefault(50)),
    concurrency: Flag.Int("concurrency").pipe(Flag.withDescription("Requests in flight"), Flag.withDefault(2)),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Count and list what would be rated, without calling Claude"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* ({ limit, batch, concurrency, dryRun }) {
    const db = yield* Database
    const fs = yield* FileSystem.FileSystem
    const rater = yield* FrequencyRater

    const file = resolveFromRoot(FREQUENCY_FILE)
    const ratings = (yield* fs.exists(file))
      ? parseFrequency(yield* fs.readFileString(file))
      : new Map<string, number>()

    const rated = new Set(ratings.keys())
    const curated = resolveFromRoot(CURATED_FILE)
    if (yield* fs.exists(curated)) {
      for (const line of (yield* fs.readFileString(curated)).split("\n")) {
        const word = parseConsolidatedLine(line)
        if (word !== null && word.frequency !== undefined) rated.add(word.headword.toLowerCase())
      }
    }

    // Phrases only: single words have their subtitle counts.
    const unrated = [...(yield* headwordIds(db, "en")).keys()]
      .filter((headword) => headword.includes(" ") && !rated.has(headword.toLowerCase()))
      .sort()
    const pending = unrated.slice(0, limit)
    yield* Console.log(`${ratings.size} phrases rated so far; ${unrated.length} unrated, rating ${pending.length}.`)
    if (dryRun) {
      for (const phrase of pending.slice(0, 20)) yield* Console.log(`  ${phrase}`)
      if (pending.length > 20) yield* Console.log(`  … and ${pending.length - 20} more`)
      return
    }

    // The file is rewritten after every batch, so an interrupted run keeps what it rated; one
    // writer at a time, as batches finish together.
    const saving = yield* Semaphore.make(1)
    let done = 0
    let failed = 0
    const save = (result: ReadonlyMap<string, number>) =>
      Semaphore.withPermit(saving)(
        Effect.gen(function* () {
          for (const [phrase, rating] of result) ratings.set(phrase.toLowerCase(), rating)
          done += result.size
          yield* fs.writeFileString(file, serializeFrequency(ratings))
          yield* Console.log(`Rated ${done}/${pending.length}`)
        })
      )
    yield* Effect.forEach(
      chunks(pending, batch),
      (phrases) =>
        rater.rate(phrases).pipe(
          Effect.flatMap(save),
          Effect.catch((error) =>
            Effect.logWarning(`A batch of ${phrases.length} phrases failed: ${String(error)}`).pipe(
              Effect.tap(() => Effect.sync(() => (failed += phrases.length)))
            )
          )
        ),
      { concurrency, discard: true }
    )

    const left = unrated.length - done
    yield* Console.log(
      `Done: ${done} rated, ${failed} failed, ${left} still unrated. ` +
        `Re-run \`kotori seed --dictionary english\` so the ratings reach the dictionary.`
    )
  })
).pipe(
  Command.withDescription(
    "Rate how commonly multi-word English entries are used today (1–5) with Claude, into data/english/frequency.json"
  )
)
