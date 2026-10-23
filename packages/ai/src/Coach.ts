import {
  furiganaToText,
  type HowToSayRequest,
  Issue,
  type NaturalnessRequest,
  Phrase,
  Pitfall,
  Rewrite,
  Verdict
} from "@kotori/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { howToSayPrompt, howToSaySystem, type Learner, naturalnessPrompt, naturalnessSystem } from "./prompts.ts"

export const NaturalnessOutput = Schema.Struct({
  verdict: Verdict,
  score: Schema.Int,
  summary: Schema.String,
  meaning: Schema.String,
  register: Schema.Literals(["casual", "neutral", "polite", "formal", "mixed"]),
  issues: Schema.Array(Issue),
  rewrites: Schema.Array(Rewrite)
})
export type NaturalnessOutput = typeof NaturalnessOutput.Type

export const HowToSayOutput = Schema.Struct({
  intent: Schema.String,
  phrases: Schema.Array(Phrase),
  keyWords: Schema.Array(
    Schema.Struct({
      word: Schema.String,
      reading: Schema.String,
      meaning: Schema.String,
      note: Schema.String
    })
  ),
  pitfalls: Schema.Array(Pitfall),
  culturalNote: Schema.NullOr(Schema.String)
})
export type HowToSayOutput = typeof HowToSayOutput.Type

/** Drops furigana that doesn't spell out the sentence it annotates, rather than show wrong readings. */
const checkedFurigana = (text: string, furigana: string | null) =>
  furigana !== null && furiganaToText(furigana) === text ? furigana : null

export class Coach extends Context.Service<
  Coach,
  {
    naturalness(request: NaturalnessRequest, learner: Learner): Effect.Effect<NaturalnessOutput, ClaudeError>
    howToSay(request: HowToSayRequest, learner: Learner): Effect.Effect<HowToSayOutput, ClaudeError>
  }
>()("@kotori/ai/Coach") {
  static readonly layer = Layer.effect(
    Coach,
    Effect.gen(function* () {
      const claude = yield* Claude

      const naturalness = Effect.fn("Coach.naturalness")(function* (request: NaturalnessRequest, learner: Learner) {
        const output = yield* claude.generate({
          schema: NaturalnessOutput,
          system: naturalnessSystem(learner),
          prompt: naturalnessPrompt(request),
          effort: "medium"
        })
        return {
          ...output,
          score: Math.min(Math.max(output.score, 0), 100),
          rewrites: output.rewrites.map((rewrite) => ({
            ...rewrite,
            furigana: checkedFurigana(rewrite.text, rewrite.furigana)
          }))
        }
      })

      const howToSay = Effect.fn("Coach.howToSay")(function* (request: HowToSayRequest, learner: Learner) {
        const output = yield* claude.generate({
          schema: HowToSayOutput,
          system: howToSaySystem(learner),
          prompt: howToSayPrompt(request),
          effort: "medium"
        })
        return {
          ...output,
          phrases: output.phrases.map((phrase) => ({
            ...phrase,
            furigana: checkedFurigana(phrase.text, phrase.furigana)
          }))
        }
      })

      return Coach.of({ naturalness, howToSay })
    })
  )
}
