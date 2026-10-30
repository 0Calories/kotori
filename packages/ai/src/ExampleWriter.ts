import {
  Formality,
  furiganaToText,
  type Language,
  SentenceMedium,
  SentenceTone,
  SpeakerAge,
  SpeakerGender
} from "@kotori/domain"
import { normalizeGloss, normalizeJapaneseGloss } from "@kotori/db"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "./Claude.ts"
import { englishExamplesSystem, examplesSystem } from "./prompts.ts"

export const ExamplesOutput = Schema.Struct({
  senses: Schema.Array(
    Schema.Struct({
      sense: Schema.Int,
      /** The sense's usage note for learners of Japanese, in English; null when the glosses say it all. */
      note: Schema.NullOr(Schema.String),
      examples: Schema.Array(
        Schema.Struct({
          /** The gloss of its sense the sentence uses, copied from the list, so a misfiled one can be dropped. */
          gloss: Schema.String,
          ja: Schema.String,
          furigana: Schema.String,
          en: Schema.String,
          formality: Formality,
          speaker: Schema.Struct({ gender: SpeakerGender, age: SpeakerAge }),
          medium: SentenceMedium,
          /** Regional variety as a lowercase label ("kansai"); null for the standard language. */
          variety: Schema.NullOr(Schema.String),
          tone: SentenceTone,
          note: Schema.NullOr(Schema.String)
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
      /** The sense's usage note for Japanese speakers, in Japanese; null when the glosses say it all. */
      noteJa: Schema.NullOr(Schema.String),
      examples: Schema.Array(
        Schema.Struct({
          gloss: Schema.String,
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

/** The usage note for one sense, in the learner's language: `note` on a Japanese word, `noteJa` on an English one. */
export interface WrittenSenseNote {
  readonly sense: number
  readonly note: string | null
  readonly noteJa: string | null
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

export interface WrittenExamples {
  /** One usage note per sense; the examples only annotate what is specific to a sentence. */
  readonly notes: ReadonlyArray<WrittenSenseNote>
  readonly examples: ReadonlyArray<WrittenExample>
  /** Sentences left out because the gloss they name isn't their sense's: misfiled, or a meaning not listed. */
  readonly dropped: number
}

/**
 * Whether a sentence uses the sense it is filed under: the gloss Claude names for it is one of
 * that sense's, as the import normalises them, or a part of one. "claim" filed under
 * （手間などを）要する but naming 命を奪う, a sense it wasn't shown, is not.
 */
const fitsSense = (sense: ExampleSense | undefined, gloss: string, language: Language) => {
  // Glosses are in the other language from the headword.
  const norm = language === "ja" ? normalizeGloss : normalizeJapaneseGloss
  const named = norm(gloss)
  if (sense === undefined || named.length < 2) return false
  return sense.glosses.some((own) => {
    const listed = norm(own)
    return listed.length > 0 && (listed === named || listed.includes(named) || named.includes(listed))
  })
}

/** The groups of the senses asked about, each keeping only the sentences that fit its sense. */
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

      /** English sentences with Japanese translations, for Japanese speakers learning the word. */
      const writeEnglish = Effect.fn("ExampleWriter.writeEnglish")(function* (request: ExampleRequest) {
        const output = yield* claude.generate({
          schema: EnglishExamplesOutput,
          system: englishExamplesSystem,
          prompt: describeRequest(request),
          effort: "low"
        })
        const { groups, dropped } = filed(request, output.senses)
        return {
          dropped,
          notes: groups.map((group) => ({ sense: group.sense, note: null, noteJa: group.noteJa ?? null })),
          examples: groups.flatMap((group) =>
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
        }
      })

      const write = Effect.fn("ExampleWriter.write")(function* (request: ExampleRequest) {
        if (request.language === "en") return yield* writeEnglish(request)
        const output = yield* claude.generate({
          schema: ExamplesOutput,
          system: examplesSystem,
          prompt: describeRequest(request),
          effort: "low"
        })
        const { groups, dropped } = filed(request, output.senses)
        return {
          dropped,
          notes: groups.map((group) => ({ sense: group.sense, note: group.note ?? null, noteJa: null })),
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
              // Japanese words are read by learners of Japanese, in English.
              noteJa: null
            }))
          )
        }
      })

      return ExampleWriter.of({ model: claude.model, write })
    })
  )
}
