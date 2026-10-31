import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { loanSystem } from "./prompts.ts"

export const LoanOutput = Schema.Struct({
  /** One or two Japanese sentences on how the English word differs from the katakana word's everyday meaning. */
  loanTrap: Schema.String
})

/** An English word whose katakana loan Jev confidently judged to mean something else in everyday Japanese. */
export interface LoanRequest {
  readonly headword: string
  /** The word's IPA, or empty when the dictionary has none. */
  readonly reading: string
  /**
   * The English word's senses that bear on the comparison, in Japanese, with their usage labels:
   * its main ones and any glossed with the loan itself. Not always commonest first.
   */
  readonly meanings: ReadonlyArray<string>
  /** The katakana loanword, as the dictionary spells it. */
  readonly loanWord: string
  /** What the loanword means, from JMDict's English translations, with their usage labels. */
  readonly loanMeanings: ReadonlyArray<string>
}

/** The user turn: the English word and its senses, and the drifted loan and its meanings. */
export const describeLoan = (request: LoanRequest) =>
  [
    request.reading.length > 0
      ? `English word: ${request.headword} (${request.reading})`
      : `English word: ${request.headword}`,
    "Its senses in the dictionary, in Japanese:",
    ...request.meanings.map((meaning, index) => `${index + 1}. ${meaning}`),
    `Katakana loanword: ${request.loanWord}`,
    "Its meanings in Japanese, translated into English:",
    ...request.loanMeanings.map((meaning, index) => `${index + 1}. ${meaning}`)
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
