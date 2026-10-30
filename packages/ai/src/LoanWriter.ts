import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { loanSystem } from "./prompts.ts"

export const LoanOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
      /** The katakana loanword Japanese speakers know; null when Japanese has no common one. */
      loanWord: Schema.NullOr(Schema.String),
      /** One Japanese sentence on how the English word's meaning differs from the loanword's. */
      loanTrap: Schema.NullOr(Schema.String)
    })
  )
})

/** A sense whose English word Jev judged to have a katakana loan that drifted in meaning. */
export interface LoanSense {
  readonly index: number
  /** The English word Jev judged. */
  readonly english: string
  readonly glosses: ReadonlyArray<string>
}

export interface LoanRequest {
  readonly headword: string
  readonly reading: string
  readonly senses: ReadonlyArray<LoanSense>
}

export interface WrittenLoan {
  readonly sense: number
  readonly loanWord: string
  readonly loanTrap: string | null
}

/** The user turn: the headword and, per sense, the English word whose loan drifted. */
export const describeLoans = (request: LoanRequest) =>
  [
    `Headword: ${request.headword} (${request.reading})`,
    "Senses:",
    ...request.senses.map(
      (sense) => `${sense.index}. English word: ${sense.english}\n   meaning: ${sense.glosses.join("; ")}`
    )
  ].join("\n")

export class LoanWriter extends Context.Service<
  LoanWriter,
  {
    readonly model: string
    /** Names each sense's drifted katakana loanword and its trap; senses Claude finds no loanword for are left out. */
    write(request: LoanRequest): Effect.Effect<ReadonlyArray<WrittenLoan>, ClaudeError>
  }
>()("@kotori/ai/LoanWriter") {
  static readonly layer = Layer.effect(
    LoanWriter,
    Effect.gen(function* () {
      const claude = yield* Claude

      const write = Effect.fn("LoanWriter.write")(function* (request: LoanRequest) {
        if (request.senses.length === 0) return []
        const known = new Set(request.senses.map((sense) => sense.index))
        const output = yield* claude.generate({
          schema: LoanOutput,
          system: loanSystem,
          prompt: describeLoans(request),
          effort: "low"
        })
        return output.senses.flatMap((written): Array<WrittenLoan> =>
          known.has(written.sense) && written.loanWord !== null
            ? [{ sense: written.sense, loanWord: written.loanWord, loanTrap: written.loanTrap ?? null }]
            : []
        )
      })

      return LoanWriter.of({ model: claude.model, write })
    })
  )
}
