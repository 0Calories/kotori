import {
  type Casting,
  Formality,
  type Language,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/contracts"
import { furiganaToText, normalizeGloss, normalizeJapaneseGloss } from "@kotori/language"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, ClaudeDeadline, type ClaudeError } from "../providers/Claude.ts"
import { englishExamplesSystem, examplesSystem } from "./prompts.ts"

export const ExamplesOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
      examples: Schema.Array(
        Schema.Struct({
          gloss: Schema.String,
          ja: Schema.String,
          furigana: Schema.String,
          en: Schema.String,
          formality: Formality,
          speaker: Schema.Struct({ gender: SpeakerGender, age: SpeakerAge }),
          medium: SentenceMedium,
          variety: Schema.NullOr(Schema.String),
          tone: SentenceTone,
          note: Schema.NullOr(Schema.String)
        })
      )
    })
  )
})

export const EnglishExamplesOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
      examples: Schema.Array(
        Schema.Struct({
          gloss: Schema.String,
          en: Schema.String,
          ja: Schema.String,
          formality: Formality,
          speaker: Schema.Struct({ gender: SpeakerGender, age: SpeakerAge }),
          medium: SentenceMedium,
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
  readonly glosses: ReadonlyArray<string>
  readonly partsOfSpeech: ReadonlyArray<string>
  readonly notes: ReadonlyArray<string>
  readonly dialects: ReadonlyArray<string>
}

export interface ExampleRequest {
  readonly language: Language
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
  readonly casting: Casting
  readonly note: string | null
  readonly noteJa: string | null
}

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

const normalizeVariety = (label: string | null): string | null => {
  if (label === null) return null
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[\s-]*(ben|dialect|english|japanese)$/u, "")
    .trim()
  return normalized === "" || normalized === "standard" || normalized === "null" ? null : normalized
}

const castingOf = (example: {
  readonly speaker: { readonly gender: SpeakerGender; readonly age: SpeakerAge }
  readonly medium: SentenceMedium
  readonly variety: string | null
  readonly tone: SentenceTone
}): Casting => ({
  speakerGender: example.speaker.gender,
  speakerAge: example.speaker.age,
  medium: example.medium,
  variety: normalizeVariety(example.variety),
  tone: example.tone
})

export interface WrittenExamples {
  readonly examples: ReadonlyArray<WrittenExample>
  readonly dropped: number
}

/** Claude sometimes writes an example for a more common sense than requested; requiring it to quote a matching gloss catches misfiled sentences. */
const fitsSense = (sense: ExampleSense | undefined, gloss: string, language: Language) => {
  const norm = language === "ja" ? normalizeGloss : normalizeJapaneseGloss
  const named = norm(gloss)
  if (sense === undefined || named.length < 2) return false
  return sense.glosses.some((own) => {
    const listed = norm(own)
    return listed.length > 0 && (listed === named || listed.includes(named) || named.includes(listed))
  })
}

const filed = <
  E extends { readonly gloss: string },
  G extends { readonly sense: number; readonly examples: ReadonlyArray<E> }
>(
  request: ExampleRequest,
  groups: ReadonlyArray<G>
) => {
  const senses = new Map(request.senses.map((sense) => [sense.index, sense]))
  const known = groups.filter((group) => senses.has(group.sense))
  const kept = known.map((group) => ({
    ...group,
    examples: group.examples.filter((example) => fitsSense(senses.get(group.sense), example.gloss, request.language))
  }))
  const count = (list: ReadonlyArray<G>) => list.reduce((sum, group) => sum + group.examples.length, 0)
  return { groups: kept, dropped: count(known) - count(kept) }
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

      const writeEnglish = Effect.fn("ExampleWriter.writeEnglish")(function* (request: ExampleRequest) {
        const output = yield* claude.generate({
          schema: EnglishExamplesOutput,
          system: englishExamplesSystem,
          prompt: describeRequest(request),
          effort: "low",
          timeout: ClaudeDeadline.bulk
        })
        const { groups, dropped } = filed(request, output.senses)
        return {
          dropped,
          examples: groups.flatMap((group) =>
            group.examples.map((example): WrittenExample => ({
              sense: group.sense,
              ja: example.ja,
              furigana: example.ja,
              en: example.en,
              formality: example.formality,
              casting: castingOf(example),
              note: null,
              noteJa: example.noteJa
            }))
          )
        }
      })

      const write = Effect.fn("ExampleWriter.write")(function* (request: ExampleRequest) {
        if (request.language === "en") return yield* writeEnglish(request)
        const output = yield* claude.generate({
          schema: ExamplesOutput,
          system: examplesSystem,
          prompt: describeRequest(request),
          effort: "low",
          timeout: ClaudeDeadline.bulk
        })
        const { groups, dropped } = filed(request, output.senses)
        return {
          dropped,
          examples: groups.flatMap((group) =>
            group.examples.map((example) => ({
              sense: group.sense,
              ja: furiganaToText(example.furigana) || example.ja,
              furigana: furiganaToText(example.furigana) === example.ja ? example.furigana : example.ja,
              en: example.en,
              formality: example.formality,
              casting: castingOf(example),
              note: example.note,
              noteJa: null
            }))
          )
        }
      })

      return ExampleWriter.of({ model: claude.model, write })
    })
  )
}
