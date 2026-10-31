import * as Schema from "effect/Schema"
import { Language } from "./Language.ts"
import { Difference, Formality, Loanword, Nuance } from "./Nuance.ts"

/** JMDict's `ent_seq` for Japanese words; English words are numbered from 100,000,000. */
export const EntryId = Schema.Int.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

/** A JMDict tag such as `v5r` with its human-readable description. */
export const Tag = Schema.Struct({ code: Schema.String, label: Schema.String })
export type Tag = typeof Tag.Type

export const Form = Schema.Struct({
  text: Schema.String,
  /** Japanese words are written in kanji and kana; English ones have other spellings and inflections. */
  kind: Schema.Literals(["kanji", "kana", "spelling", "inflection"]),
  common: Schema.Boolean,
  /** Usage tags for Japanese forms; what an English inflection is ("past", "plural"). */
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

/** The dominant feel of the delivery; "humorous" sends a sentence to a comic voice, the rest is stored for voice settings. */
export const SentenceTone = Schema.Literals(["neutral", "cheerful", "serious", "gentle", "rough", "humorous"])
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
  /** A note on the English sentence for Japanese speakers, in Japanese. */
  noteJa: Schema.NullOr(Schema.String),
  /** The Japanese sentence, spoken. */
  audioUrl: Schema.NullOr(Schema.String),
  /** The English translation, spoken. */
  translationAudioUrl: Schema.NullOr(Schema.String)
})
export type Example = typeof Example.Type

export const Sense = Schema.Struct({
  index: Schema.Int,
  /** What the word means, in the other language: English for a Japanese word, Japanese for an English one. */
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
  /** Kotori's usage note on this sense for learners of Japanese, in English; on Japanese words. */
  note: Schema.NullOr(Schema.String),
  /** The same for learners of English, in Japanese; on English words. */
  noteJa: Schema.NullOr(Schema.String),
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

/**
 * A word in the learner's target language, explained in their own: a Japanese word from
 * JMDict for English speakers, an English word for Japanese speakers.
 */
export const Entry = Schema.Struct({
  id: EntryId,
  /** The headword's language. */
  language: Language,
  headword: Schema.String,
  /** Kana for a Japanese word; IPA for an English one, or empty when the dictionary has none. */
  reading: Schema.String,
  /** The kana reading in rōmaji; empty for English words. */
  romaji: Schema.String,
  common: Schema.Boolean,
  forms: Schema.Array(Form),
  senses: Schema.Array(Sense),
  /** The first headword clip; kept until the app plays from `audio`. */
  audioUrl: Schema.NullOr(Schema.String),
  /** Every headword clip, one per dictionary voice. */
  audio: Schema.Array(EntryAudio),
  /** An English word's katakana loan, once judged; null for Japanese words and English words without one. */
  loan: Schema.NullOr(Loanword),
  enrichment: Enrichment
})
export type Entry = typeof Entry.Type

export const EntrySummary = Schema.Struct({
  id: EntryId,
  language: Language,
  headword: Schema.String,
  reading: Schema.String,
  romaji: Schema.String,
  common: Schema.Boolean,
  meanings: Schema.Array(Schema.String),
  partOfSpeech: Schema.NullOr(Schema.String),
  formality: Schema.NullOr(Formality),
  /** Inflections undone to find this entry, e.g. ["polite", "past"] for 食べました or ["past"] for "ate". */
  inflection: Schema.Array(Schema.String)
})
export type EntrySummary = typeof EntrySummary.Type

export const SearchMode = Schema.Literals(["japanese", "english", "romaji"])
export type SearchMode = typeof SearchMode.Type

/** How the query was read: as Japanese, as English, or as rōmaji for Japanese. */
export const SearchResult = Schema.Struct({
  query: Schema.String,
  mode: SearchMode,
  /** The kana reading searched for, when the query was romaji. */
  reading: Schema.NullOr(Schema.String),
  entries: Schema.Array(EntrySummary)
})
export type SearchResult = typeof SearchResult.Type
