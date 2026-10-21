import { NodeRuntime } from "@effect/platform-node"
import { Claude } from "@kotori/ai"
import { loadDotEnv } from "@kotori/db"
import { Effect, Schema } from "effect"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { corpus } from "./corpus.ts"
import { GeneratedBatch, type SituationDraft } from "./schema.ts"

loadDotEnv()

const outFlag = process.argv.indexOf("--out")
const out = outFlag >= 0 ? process.argv[outFlag + 1] ?? "data/situations.generated.json" : "data/situations.generated.json"

const system = `You fill in a prototype phrasebook of everyday situations for English speakers learning Japanese.
For each situation id, return:
- aliases: 5 to 8 natural English phrases a learner would type into a dictionary, plus 1 or 2 short Japanese aliases. Vary the wording. Do not copy the hint verbatim more than once.
- note: one short English usage note.
- phrases: 2 or 3 things a native would actually say. "ja" is normal writing, "reading" is hiragana for the whole phrase, "en" is a natural translation, "formality" is casual, neutral, polite, or formal.
- words: 1 to 3 dictionary-form Japanese headwords that occur in the phrases, each with its kana reading. Common words only. Do not invent dictionary ids.
Keep the ids exactly as given.`

const batches = <A>(items: readonly A[], size: number) => {
  const out: A[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const program = Effect.gen(function*() {
  const claude = yield* Claude
  const byId = new Map(corpus.map((situation) => [situation.id, situation]))
  const written: SituationDraft[] = []

  for (const batch of batches(corpus, 8)) {
    const prompt = batch.map((situation) => `${situation.id}: ${situation.title} (${situation.category}). Hint: ${situation.note}`)
      .join("\n")
    const result = yield* claude.generate({
      schema: GeneratedBatch,
      system,
      prompt,
      effort: "low",
      maxTokens: 8_000
    })
    for (const row of result.situations) {
      const brief = byId.get(row.id)
      if (brief === undefined) return yield* Effect.die(`generator returned unknown id ${row.id}`)
      written.push({ ...brief, aliases: row.aliases, note: row.note, phrases: row.phrases, words: row.words })
    }
    yield* Effect.logInfo(`generated ${written.length}/${corpus.length}`)
  }

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(written, null, 2))
  yield* Effect.logInfo(`wrote ${written.length} situations to ${out}`)
}).pipe(
  Effect.provide(Claude.layer),
  Effect.catch((cause) =>
    Effect.sync(() => {
      console.error(
        "Situation generation needs the Claude credentials used by packages/ai (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN)."
      )
      console.error(cause)
      process.exitCode = 1
    })
  )
)

NodeRuntime.runMain(program)
