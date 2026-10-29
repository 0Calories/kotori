import { Formality, furiganaToText, SentenceMedium, SentenceTone, SpeakerAge, SpeakerGender } from "@kotori/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { examplesSystem } from "./prompts.ts"

export const ExamplesOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
      /** The sense's usage note for learners of Japanese, in English; null when the glosses say it all. */
      note: Schema.NullOr(Schema.String),
      /** The note on the sense's English side for Japanese speakers learning English, in Japanese. */
      noteJa: Schema.NullOr(Schema.String),
      /** The katakana loanword and its trap sentence; null unless the request marks the sense. */
      loanWord: Schema.NullOr(Schema.String),
      loanTrap: Schema.NullOr(Schema.String),
      examples: Schema.Array(
        Schema.Struct({
          ja: Schema.String,
          furigana: Schema.String,
          en: Schema.String,
          formality: Formality,
          speaker: Schema.Struct({ gender: SpeakerGender, age: SpeakerAge }),
          medium: SentenceMedium,
          /** Regional variety as a lowercase label ("kansai"); null for the standard language. */
          variety: Schema.NullOr(Schema.String),
          tone: SentenceTone,
          note: Schema.NullOr(Schema.String),
          noteJa: Schema.NullOr(Schema.String)
        })
      )
    })
  )
})

export interface ExampleSense {
  readonly index: number
  readonly glosses: ReadonlyArray<string>
  readonly partsOfSpeech: ReadonlyArray<string>
  /** Human-readable usage tags and notes (e.g. "honorific language", "colloquial"). */
  readonly notes: ReadonlyArray<string>
  /** Dialect labels from JMDict (e.g. "Kansai-ben"); the sentences are written in that dialect. */
  readonly dialects: ReadonlyArray<string>
  /** Jev judged a katakana loan of this sense's English to diverge; Claude names it and the trap. */
  readonly loanDiverges?: boolean
}

export interface ExampleRequest {
  readonly headword: string
  readonly reading: string
  readonly otherForms: ReadonlyArray<string>
  readonly senses: ReadonlyArray<ExampleSense>
  readonly perSense: number
}

/** The usage note for one sense, in both learner directions, plus the loanword trap when asked for. */
export interface WrittenSenseNote {
  readonly sense: number
  readonly note: string | null
  readonly noteJa: string | null
  readonly loanWord: string | null
  readonly loanTrap: string | null
}

export interface WrittenExample {
  readonly sense: number
  readonly ja: string
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly speakerGender: SpeakerGender
  readonly speakerAge: SpeakerAge
  readonly medium: SentenceMedium
  /** Lowercased regional variety label, or null for the standard language. */
  readonly variety: string | null
  readonly tone: SentenceTone
  readonly note: string | null
  /** For Japanese speakers learning English, in Japanese. */
  readonly noteJa: string | null
}

/** The user turn: the headword and each sense with the hints that shape its sentences. */
export const describeRequest = (request: ExampleRequest) =>
  [
    `Headword: ${request.headword} (${request.reading})`,
    request.otherForms.length > 0 ? `Other forms: ${request.otherForms.join(", ")}` : null,
    `Sentences per sense: ${request.perSense}`,
    "Senses:",
    ...request.senses.map((sense) =>
      [
        `${sense.index}. ${sense.glosses.join("; ")}`,
        sense.partsOfSpeech.length > 0 ? `   part of speech: ${sense.partsOfSpeech.join(", ")}` : null,
        sense.dialects.length > 0 ? `   dialect: ${sense.dialects.join(", ")} (write every sentence in it)` : null,
        sense.notes.length > 0 ? `   notes: ${sense.notes.join("; ")}` : null,
        sense.loanDiverges ? "   katakana loan diverges: give loanWord and loanTrap" : null
      ]
        .filter((line) => line !== null)
        .join("\n")
    )
  ]
    .filter((line) => line !== null)
    .join("\n")

/** "Kansai-ben", "Kansai dialect" and "kansai" all mean the same variety to casting. */
const normalizeVariety = (label: string | null): string | null => {
  if (label === null) return null
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[\s-]*(ben|dialect|english|japanese)$/u, "")
    .trim()
  return normalized === "" || normalized === "standard" || normalized === "null" ? null : normalized
}

export interface WrittenExamples {
  /** One usage note per sense; the examples only annotate what is specific to a sentence. */
  readonly notes: ReadonlyArray<WrittenSenseNote>
  readonly examples: ReadonlyArray<WrittenExample>
}

export class ExampleWriter extends Context.Service<
  ExampleWriter,
  {
    readonly model: string
    write(request: ExampleRequest): Effect.Effect<WrittenExamples, ClaudeError>
  }
>()("@kotori/ai/ExampleWriter") {
  static readonly layer = Layer.effect(
    ExampleWriter,
    Effect.gen(function* () {
      const claude = yield* Claude

      const write = Effect.fn("ExampleWriter.write")(function* (request: ExampleRequest) {
        const known = new Set(request.senses.map((sense) => sense.index))
        const output = yield* claude.generate({
          schema: ExamplesOutput,
          system: examplesSystem,
          prompt: describeRequest(request),
          effort: "low"
        })
        const groups = output.senses.filter((group) => known.has(group.sense))
        return {
          notes: groups.map((group) => ({
            sense: group.sense,
            note: group.note ?? null,
            noteJa: group.noteJa ?? null,
            loanWord: group.loanWord ?? null,
            loanTrap: group.loanTrap ?? null
          })),
          examples: groups.flatMap((group) =>
            group.examples.map((example) => ({
              sense: group.sense,
              // The furigana is the authoritative copy: it must spell the sentence out exactly.
              ja: furiganaToText(example.furigana) || example.ja,
              furigana: furiganaToText(example.furigana) === example.ja ? example.furigana : example.ja,
              en: example.en,
              formality: example.formality,
              speakerGender: example.speaker.gender,
              speakerAge: example.speaker.age,
              medium: example.medium,
              variety: normalizeVariety(example.variety),
              tone: example.tone,
              note: example.note,
              noteJa: example.noteJa
            }))
          )
        }
      })

      return ExampleWriter.of({ model: claude.model, write })
    })
  )
}
