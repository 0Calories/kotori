import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { loanSystem } from "./prompts.ts"

export const LoanOutput = Schema.Struct({
  loans: Schema.Array(
    Schema.Struct({
      item: Schema.Int,
      /** One Japanese sentence on how the English word's meaning differs from the katakana word's everyday meaning. */
      loanTrap: Schema.String
    })
  )
})

/** An English gloss whose katakana loan Jev confidently judged to mean something else in everyday Japanese. */
export interface LoanItem {
  /** The English word: a gloss of the headword. */
  readonly english: string
  /** The sense's glosses: what the English word means here. */
  readonly meaning: string
  /** The katakana loanword, as the dictionary spells it. */
  readonly loanWord: string
}

export interface LoanRequest {
  readonly headword: string
  readonly reading: string
  readonly items: ReadonlyArray<LoanItem>
}

export interface WrittenLoan {
  /** The item's index in the request. */
  readonly item: number
  readonly loanTrap: string
}

/** The user turn: the headword and, per numbered item, the English word, its meaning and the drifted loan. */
export const describeLoans = (request: LoanRequest) =>
  [
    `Headword: ${request.headword} (${request.reading})`,
    "Items:",
    ...request.items.map(
      (item, index) =>
        `${index}. English word: ${item.english}\n   meaning here: ${item.meaning}\n   katakana loanword: ${item.loanWord}`
    )
  ].join("\n")

export class LoanWriter extends Context.Service<
  LoanWriter,
  {
    readonly model: string
    /** Writes the warning for each item; items Claude leaves out, or answers blank, get none. */
    write(request: LoanRequest): Effect.Effect<ReadonlyArray<WrittenLoan>, ClaudeError>
  }
>()("@kotori/ai/LoanWriter") {
  static readonly layer = Layer.effect(
    LoanWriter,
    Effect.gen(function* () {
      const claude = yield* Claude

      const write = Effect.fn("LoanWriter.write")(function* (request: LoanRequest) {
        if (request.items.length === 0) return []
        const output = yield* claude.generate({
          schema: LoanOutput,
          system: loanSystem,
          prompt: describeLoans(request),
          effort: "low"
        })
        return output.loans.flatMap((written): Array<WrittenLoan> => {
          const loanTrap = written.loanTrap.trim()
          return written.item >= 0 && written.item < request.items.length && loanTrap.length > 0
            ? [{ item: written.item, loanTrap }]
            : []
        })
      })

      return LoanWriter.of({ model: claude.model, write })
    })
  )
}
