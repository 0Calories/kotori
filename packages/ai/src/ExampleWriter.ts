import {
  Formality,
  furiganaToText,
  type Language,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { englishExamplesSystem, examplesSystem } from "./prompts.ts"

export const ExamplesOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
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

/** Sentences for an English word: the same signals, with the Japanese as the translation and no furigana. */
export const EnglishExamplesOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
      examples: Schema.Array(
        Schema.Struct({
          en: Schema.String,
          ja: Schema.String,
          formality: Formality,
          speaker: Schema.Struct({ gender: SpeakerGender, age: SpeakerAge }),
          medium: SentenceMedium,
          /** Variety of English as a lowercase label ("british"); null for American English. */
          variety: Schema.NullOr(Schema.String),
          tone: SentenceTone,
          noteJa: Schema.NullOr(Schema.String)
        })
      )
    })
  )
})

export interface ExampleSense {
  readonly index: number
  /** In the other language from the headword: English for a Japanese word, Japanese for an English one. */
  readonly glosses: ReadonlyArray<string>
  readonly partsOfSpeech: ReadonlyArray<string>
  /** Human-readable usage tags and notes (e.g. "honorific language", "colloquial"). */
  readonly notes: ReadonlyArray<string>
  /** Dialect labels from JMDict (e.g. "Kansai-ben"); the sentences are written in that dialect. */
  readonly dialects: ReadonlyArray<string>
}

export interface ExampleRequest {
  /** The headword's language: sentences are written in it and translated into the other. */
  readonly language: Language
  readonly headword: string
  /** Kana for a Japanese word; IPA, or empty, for an English one. */
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
    request.reading.length > 0 ? `Headword: ${request.headword} (${request.reading})` : `Headword: ${request.headword}`,
    request.otherForms.length > 0 ? `Other forms: ${request.otherForms.join(", ")}` : null,
    `Sentences per sense: ${request.perSense}`,
    "Senses:",
    ...request.senses.map((sense) =>
      [
        `${sense.index}. ${sense.glosses.join("; ")}`,
        sense.partsOfSpeech.length > 0 ? `   part of speech: ${sense.partsOfSpeech.join(", ")}` : null,
        sense.dialects.length > 0 ? `   dialect: ${sense.dialects.join(", ")} (write every sentence in it)` : null,
        sense.notes.length > 0 ? `   notes: ${sense.notes.join("; ")}` : null
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

export class ExampleWriter extends Context.Service<
  ExampleWriter,
  {
    readonly model: string
    write(request: ExampleRequest): Effect.Effect<ReadonlyArray<WrittenExample>, ClaudeError>
  }
>()("@kotori/ai/ExampleWriter") {
  static readonly layer = Layer.effect(
    ExampleWriter,
    Effect.gen(function* () {
      const claude = yield* Claude

      /** English sentences with Japanese translations, for Japanese speakers learning the word. */
      const writeEnglish = Effect.fn("ExampleWriter.writeEnglish")(function* (request: ExampleRequest) {
        const known = new Set(request.senses.map((sense) => sense.index))
        const output = yield* claude.generate({
          schema: EnglishExamplesOutput,
          system: englishExamplesSystem,
          prompt: describeRequest(request),
          effort: "low"
        })
        return output.senses
          .filter((group) => known.has(group.sense))
          .flatMap((group) =>
            group.examples.map((example): WrittenExample => ({
              sense: group.sense,
              ja: example.ja,
              // Japanese speakers read the translation without readings.
              furigana: example.ja,
              en: example.en,
              formality: example.formality,
              speakerGender: example.speaker.gender,
              speakerAge: example.speaker.age,
              medium: example.medium,
              variety: normalizeVariety(example.variety),
              tone: example.tone,
              note: null,
              noteJa: example.noteJa
            }))
          )
      })

      const write = Effect.fn("ExampleWriter.write")(function* (request: ExampleRequest) {
        if (request.language === "en") return yield* writeEnglish(request)
        const known = new Set(request.senses.map((sense) => sense.index))
        const output = yield* claude.generate({
          schema: ExamplesOutput,
          system: examplesSystem,
          prompt: describeRequest(request),
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
              speakerGender: example.speaker.gender,
              speakerAge: example.speaker.age,
              medium: example.medium,
              variety: normalizeVariety(example.variety),
              tone: example.tone,
              note: example.note,
              noteJa: example.noteJa
            }))
          )
      })

      return ExampleWriter.of({ model: claude.model, write })
    })
  )
}
