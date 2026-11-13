import { Context, Effect, Layer, Schema } from "effect"
import { Claude, ClaudeDeadline, type ClaudeError } from "../providers/Claude.ts"

export const FrequencyOutput = Schema.Struct({
  ratings: Schema.Array(
    Schema.Struct({
      /** The expression, copied from the list. */
      phrase: Schema.String,
      frequency: Schema.Int
    })
  )
})
export type FrequencyOutput = typeof FrequencyOutput.Type

/**
 * The scale the curated English entries were rated on, so ratings from here rank alongside
 * theirs: how commonly native speakers use an expression today, from everyday to rare.
 */
export const frequencySystem = `You rate how commonly English expressions are used by native speakers today, for a dictionary used by English learners. The rating decides how prominently the dictionary lists an expression and whether learners are told it is worth memorising.

Rate each expression as a whole, with the meaning native speakers take it to have, in present-day American English unless its wording is clearly another variety:
5 — Everyday: heard constantly in ordinary conversation; every learner should know it (a lot of, hang out, what's up, piece of cake).
4 — Common: natives use it regularly in speech and writing, though not daily (on thin ice, keep it real, cut corners).
3 — Moderate: known to most natives and used now and then; recognising it helps a learner (a dime a dozen, beat around the bush).
2 — Dated or niche: understood, but old-fashioned, literary, regional or mainly older speakers', and rarely said in conversation today (a stone's throw away, hither and yon, dressed to the nines).
1 — Rare: archaic, obsolete or so uncommon that many natives would not recognise it, or not a fixed expression at all (a cat may look at a king).

Judge how much the expression is used, not how proper it is: slang and profanity in daily use rate high, and so do formal expressions in daily business use. Return every expression exactly as written, each once.`

const frequencyPrompt = (phrases: ReadonlyArray<string>) =>
  `Rate these ${phrases.length} expressions:\n\n${phrases.map((phrase) => `- ${phrase}`).join("\n")}`

/** Rates how commonly English phrases are used by native speakers today, 1–5, in batches. */
export class FrequencyRater extends Context.Service<
  FrequencyRater,
  {
    /** Ratings by phrase, as given; a phrase Claude skipped or rated off the scale is left out. */
    rate(phrases: ReadonlyArray<string>): Effect.Effect<ReadonlyMap<string, number>, ClaudeError>
  }
>()("@kotori/ai/FrequencyRater") {
  static readonly layer = Layer.effect(
    FrequencyRater,
    Effect.gen(function* () {
      const claude = yield* Claude

      const rate = Effect.fn("FrequencyRater.rate")(function* (phrases: ReadonlyArray<string>) {
        const ratings = new Map<string, number>()
        if (phrases.length === 0) return ratings
        const output = yield* claude.generate({
          schema: FrequencyOutput,
          system: frequencySystem,
          prompt: frequencyPrompt(phrases),
          effort: "low",
          // An offline pass over the dictionary.
          timeout: ClaudeDeadline.bulk
        })
        const asked = new Map(phrases.map((phrase) => [phrase.toLowerCase(), phrase]))
        for (const { phrase, frequency } of output.ratings) {
          const given = asked.get(phrase.trim().toLowerCase())
          if (given !== undefined && frequency >= 1 && frequency <= 5) ratings.set(given, frequency)
        }
        return ratings
      })

      return FrequencyRater.of({ rate })
    })
  )
}
