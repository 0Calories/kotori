import * as Schema from "effect/Schema"
import { Difference, Formality, Nuance } from "./Nuance.ts"

/** JMDict's `ent_seq`. */
export const EntryId = Schema.Int.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

/** A JMDict tag such as `v5r` with its human-readable description. */
export const Tag = Schema.Struct({ code: Schema.String, label: Schema.String })
export type Tag = typeof Tag.Type

export const Form = Schema.Struct({
  text: Schema.String,
  kind: Schema.Literals(["kanji", "kana"]),
  common: Schema.Boolean,
  tags: Schema.Array(Tag)
})
export type Form = typeof Form.Type

export const CrossReference = Schema.Struct({
  text: Schema.String,
  entryId: Schema.NullOr(EntryId)
})
export type CrossReference = typeof CrossReference.Type

export const SimilarWord = Schema.Struct({
  entryId: EntryId,
  headword: Schema.String,
  reading: Schema.String,
  meaning: Schema.String,
  difference: Difference,
  confidence: Schema.Number,
  formality: Schema.NullOr(Formality)
})
export type SimilarWord = typeof SimilarWord.Type

/** Who would plausibly say an example sentence, as judged when it was written. */
export const SpeakerGender = Schema.Literals(["masculine", "feminine", "unspecified"])
export type SpeakerGender = typeof SpeakerGender.Type

export const SpeakerAge = Schema.Literals(["child", "youth", "adult", "middle-aged", "older", "unspecified"])
export type SpeakerAge = typeof SpeakerAge.Type

/** Conversation (someone talking to someone), announcement (news, notices, mail read aloud) or narration (prose). */
export const SentenceMedium = Schema.Literals(["conversation", "announcement", "narration"])
export type SentenceMedium = typeof SentenceMedium.Type

/** The dominant feel of the delivery; stored for voice settings, not used for casting yet. */
export const SentenceTone = Schema.Literals(["neutral", "cheerful", "serious", "gentle", "rough"])
export type SentenceTone = typeof SentenceTone.Type

/** How a clip's voice was chosen: scoring alone, Jev breaking a tie, or a person via the CLI. */
export const CastBy = Schema.Literals(["rules", "jev", "manual"])
export type CastBy = typeof CastBy.Type

export const Example = Schema.Struct({
  id: Schema.Int,
  /** The sentence in Japanese. */
  ja: Schema.String,
  /** The same sentence with `{base|reading}` furigana. */
  furigana: Schema.String,
  en: Schema.String,
  formality: Formality,
  note: Schema.NullOr(Schema.String),
  /** The Japanese sentence, spoken. */
  audioUrl: Schema.NullOr(Schema.String),
  /** The English translation, spoken. */
  translationAudioUrl: Schema.NullOr(Schema.String)
})
export type Example = typeof Example.Type

export const Sense = Schema.Struct({
  index: Schema.Int,
  glosses: Schema.Array(Schema.String),
  partsOfSpeech: Schema.Array(Tag),
  misc: Schema.Array(Tag),
  fields: Schema.Array(Tag),
  dialects: Schema.Array(Tag),
  info: Schema.Array(Schema.String),
  /** Forms this sense is restricted to; empty means every form. */
  appliesTo: Schema.Array(Schema.String),
  related: Schema.Array(CrossReference),
  antonyms: Schema.Array(CrossReference),
  nuance: Schema.NullOr(Nuance),
  similar: Schema.Array(SimilarWord),
  examples: Schema.Array(Example)
})
export type Sense = typeof Sense.Type

export const EnrichmentStatus = Schema.Literals(["ready", "queued", "unavailable"])
export type EnrichmentStatus = typeof EnrichmentStatus.Type

export const Enrichment = Schema.Struct({
  nuance: EnrichmentStatus,
  examples: EnrichmentStatus,
  audio: EnrichmentStatus
})
export type Enrichment = typeof Enrichment.Type

/** One spoken headword clip and who reads it. */
export const EntryAudio = Schema.Struct({
  url: Schema.String,
  /** Kotori voice id from the cast, e.g. "ja-kyoko"; null for clips made before casting. */
  voice: Schema.NullOr(Schema.String),
  voiceName: Schema.NullOr(Schema.String)
})
export type EntryAudio = typeof EntryAudio.Type

export const Entry = Schema.Struct({
  id: EntryId,
  headword: Schema.String,
  reading: Schema.String,
  romaji: Schema.String,
  common: Schema.Boolean,
  forms: Schema.Array(Form),
  senses: Schema.Array(Sense),
  /** The first headword clip; kept until the app plays from `audio`. */
  audioUrl: Schema.NullOr(Schema.String),
  /** Every headword clip, one per dictionary voice. */
  audio: Schema.Array(EntryAudio),
  enrichment: Enrichment
})
export type Entry = typeof Entry.Type

export const EntrySummary = Schema.Struct({
  id: EntryId,
  headword: Schema.String,
  reading: Schema.String,
  romaji: Schema.String,
  common: Schema.Boolean,
  meanings: Schema.Array(Schema.String),
  partOfSpeech: Schema.NullOr(Schema.String),
  formality: Schema.NullOr(Formality),
  /** Inflections undone to find this entry, e.g. ["polite", "past"] for 食べました. */
  inflection: Schema.Array(Schema.String)
})
export type EntrySummary = typeof EntrySummary.Type

export const SearchMode = Schema.Literals(["japanese", "english", "romaji"])
export type SearchMode = typeof SearchMode.Type

export const SearchResult = Schema.Struct({
  query: Schema.String,
  mode: SearchMode,
  /** The kana reading searched for, when the query was romaji. */
  reading: Schema.NullOr(Schema.String),
  entries: Schema.Array(EntrySummary)
})
export type SearchResult = typeof SearchResult.Type
