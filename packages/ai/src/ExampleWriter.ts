import { Formality, furiganaToText } from "@kotori/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { examplesSystem } from "./prompts.ts"

export const ExamplesOutput = Schema.Struct({
  senses: Schema.Array(Schema.Struct({
    sense: Schema.Int,
    examples: Schema.Array(Schema.Struct({
      ja: Schema.String,
      furigana: Schema.String,
      en: Schema.String,
      formality: Formality,
      note: Schema.NullOr(Schema.String)
    }))
  }))
})

export interface ExampleSense {
  readonly index: number
  readonly glosses: ReadonlyArray<string>
  readonly partsOfSpeech: ReadonlyArray<string>
  /** Human-readable usage tags and notes (e.g. "honorific language", "colloquial"). */
  readonly notes: ReadonlyArray<string>
}

export interface ExampleRequest {
  readonly headword: string
  readonly reading: string
  readonly otherForms: ReadonlyArray<string>
  readonly senses: ReadonlyArray<ExampleSense>
  readonly perSense: number
}

export interface WrittenExample {
  readonly sense: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly note: string | null
}

const describe = (request: ExampleRequest) =>
  [
    `Headword: ${request.headword} (${request.reading})`,
    request.otherForms.length > 0 ? `Other forms: ${request.otherForms.join(", ")}` : null,
    `Sentences per sense: ${request.perSense}`,
    "Senses:",
    ...request.senses.map((sense) =>
      [
        `${sense.index}. ${sense.glosses.join("; ")}`,
        sense.partsOfSpeech.length > 0 ? `   part of speech: ${sense.partsOfSpeech.join(", ")}` : null,
        sense.notes.length > 0 ? `   notes: ${sense.notes.join("; ")}` : null
      ].filter((line) => line !== null).join("\n")
    )
  ].filter((line) => line !== null).join("\n")

export class ExampleWriter extends Context.Service<ExampleWriter, {
  readonly model: string
  write(request: ExampleRequest): Effect.Effect<ReadonlyArray<WrittenExample>, ClaudeError>
}>()("@kotori/ai/ExampleWriter") {
  static readonly layer = Layer.effect(
    ExampleWriter,
    Effect.gen(function*() {
      const claude = yield* Claude

      const write = Effect.fn("ExampleWriter.write")(function*(request: ExampleRequest) {
        const known = new Set(request.senses.map((sense) => sense.index))
        const output = yield* claude.generate({
          schema: ExamplesOutput,
          system: examplesSystem,
          prompt: describe(request),
          effort: "low"
        })
        return output.senses
          .filter((group) => known.has(group.sense))
          .flatMap((group) =>
            group.examples.map((example) => ({
              sense: group.sense,
              // The furigana is the authoritative copy: it must spell the sentence out exactly.
              ja: furiganaToText(example.furigana) || example.ja,
              furigana: furiganaToText(example.furigana) === example.ja ? example.furigana : example.ja,
              en: example.en,
              formality: example.formality,
              note: example.note
            }))
          )
      })

      return ExampleWriter.of({ model: claude.model, write })
    })
  )
}
