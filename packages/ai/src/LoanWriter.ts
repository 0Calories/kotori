import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { loanSystem } from "./prompts.ts"

export const LoanOutput = Schema.Struct({
  /** One Japanese sentence on how the English word differs from the katakana word's everyday meaning. */
  loanTrap: Schema.String
})

/** An English word whose katakana loan Jev confidently judged to mean something else in everyday Japanese. */
export interface LoanRequest {
  readonly headword: string
  /** The word's IPA, or empty when the dictionary has none. */
  readonly reading: string
  /** What the English word means, in Japanese: its senses' leading glosses. */
  readonly meanings: ReadonlyArray<string>
  /** The katakana loanword, as the dictionary spells it. */
  readonly loanWord: string
}

/** The user turn: the English word, its meanings and the drifted loan. */
export const describeLoan = (request: LoanRequest) =>
  [
    request.reading.length > 0
      ? `English word: ${request.headword} (${request.reading})`
      : `English word: ${request.headword}`,
    "Meanings:",
    ...request.meanings.map((meaning, index) => `${index + 1}. ${meaning}`),
    `Katakana loanword: ${request.loanWord}`
  ].join("\n")

export class LoanWriter extends Context.Service<
  LoanWriter,
  {
    readonly model: string
    /** Writes the warning; null when Claude answers blank. */
    write(request: LoanRequest): Effect.Effect<string | null, ClaudeError>
  }
>()("@kotori/ai/LoanWriter") {
  static readonly layer = Layer.effect(
    LoanWriter,
    Effect.gen(function* () {
      const claude = yield* Claude
      const write = Effect.fn("LoanWriter.write")(function* (request: LoanRequest) {
        const output = yield* claude.generate({
          schema: LoanOutput,
          system: loanSystem,
          prompt: describeLoan(request),
          effort: "low"
        })
        const trap = output.loanTrap.trim()
        return trap.length > 0 ? trap : null
      })
      return LoanWriter.of({ model: claude.model, write })
    })
  )
}
