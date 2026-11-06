import {
  castBy,
  DraftEntry,
  DraftSense,
  entries,
  EntryId,
  examples,
  Formality,
  forms,
  Nuance,
  proposalRoute,
  proposalStatus,
  senseNotes,
  sentenceMedium,
  sentenceTone,
  similarWords,
  speakerAge,
  speakerGender,
  tags
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { Language } from "./Language.ts"
import { Currency, Loanword } from "./Nuance.ts"

export { EntryId }

const EntryRow = createSelectSchema(entries, { id: EntryId })
// `text` is a bytewise-collated custom column, which derives as unknown.
const FormRow = createSelectSchema(forms, { text: Schema.String })
const SimilarRow = createSelectSchema(similarWords)
const ExampleRow = createSelectSchema(examples)
const SenseNoteRow = createSelectSchema(senseNotes)

/** A JMDict tag such as `v5r` with its human-readable description. */
export const Tag = createSelectSchema(tags)
export type Tag = typeof Tag.Type

export const Form = Schema.Struct({
  ...Struct.pick(FormRow.fields, ["text", "kind", "common"]),
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
  ...Struct.pick(EntryRow.fields, ["headword", "reading"]),
  meaning: Schema.String,
  ...Struct.pick(SimilarRow.fields, ["difference", "confidence"]),
  formality: Schema.NullOr(Formality)
})
export type SimilarWord = typeof SimilarWord.Type

/** Who would plausibly say an example sentence, as judged when it was written. */
export const SpeakerGender = createSelectSchema(speakerGender)
export type SpeakerGender = typeof SpeakerGender.Type

export const SpeakerAge = createSelectSchema(speakerAge)
export type SpeakerAge = typeof SpeakerAge.Type

/** Conversation (someone talking to someone), announcement (news, notices, mail read aloud) or narration (prose). */
export const SentenceMedium = createSelectSchema(sentenceMedium)
export type SentenceMedium = typeof SentenceMedium.Type

/** The dominant feel of the delivery; "humorous" sends a sentence to a comic voice, the rest is stored for voice settings. */
export const SentenceTone = createSelectSchema(sentenceTone)
export type SentenceTone = typeof SentenceTone.Type

/** How a clip's voice was chosen: scoring alone, Jev breaking a tie, or a person via the CLI. */
export const CastBy = createSelectSchema(castBy)
export type CastBy = typeof CastBy.Type

export const Example = Schema.Struct({
  ...Struct.pick(ExampleRow.fields, ["id", "ja", "furigana", "en", "formality", "note", "noteJa"]),
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
  /** Kotori's usage note for learners of Japanese, in English (on Japanese words), and for learners of English, in Japanese (on English words). */
  ...Struct.pick(SenseNoteRow.fields, ["note", "noteJa"]),
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
  ...Struct.pick(EntryRow.fields, ["id", "language", "headword", "reading", "common"]),
  /** The kana reading in rōmaji; empty for English words. */
  romaji: Schema.String,
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
  ...Struct.pick(EntryRow.fields, ["id", "language", "headword", "reading", "common"]),
  romaji: Schema.String,
  meanings: Schema.Array(Schema.String),
  partOfSpeech: Schema.NullOr(Schema.String),
  formality: Schema.NullOr(Formality),
  /** How current the word's first sense feels, once judged, so a dated idiom says so in the results. */
  currency: Schema.NullOr(Currency),
  /** Inflections undone to find this entry, e.g. ["polite", "past"] for 食べました or ["past"] for "ate". */
  inflection: Schema.Array(Schema.String),
  /** The first headword clip, so results can be heard without opening the entry; null until voiced. */
  audioUrl: Schema.NullOr(Schema.String)
})
export type EntrySummary = typeof EntrySummary.Type

export { DraftEntry, DraftSense }

export const ProposalStatus = createSelectSchema(proposalStatus)
export type ProposalStatus = typeof ProposalStatus.Type

export const ProposalRoute = createSelectSchema(proposalRoute)
export type ProposalRoute = typeof ProposalRoute.Type

export const ProposalId = Schema.Int.pipe(Schema.brand("ProposalId"))
export type ProposalId = typeof ProposalId.Type

/**
 * Kotori's answer to a query the dictionary couldn't: a drafted entry awaiting the admin
 * (`pending`, shown to its askers marked unverified), a `linked` entry the dictionary already
 * had, or a `rejected` query with the reason. `approved` drafts have become the entry `linked`
 * points at; `discarded` ones were turned down by the admin.
 */
export const Proposal = Schema.Struct({
  id: ProposalId,
  query: Schema.String,
  /** The language of the word asked about. */
  language: Language,
  status: ProposalStatus,
  draft: Schema.NullOr(DraftEntry),
  /** The existing entry the query names, when there is one. */
  linked: Schema.NullOr(EntrySummary),
  /**
   * Claude's own words on why a rejected query isn't a real expression, in the asker's native
   * language; null when it gave none or Jev routed the query away, and the app words it.
   */
  reason: Schema.NullOr(Schema.String),
  /** What kind of input the query was judged to be; a rejected non-lookup tells the app where to point. */
  route: Schema.NullOr(ProposalRoute)
})
export type Proposal = typeof Proposal.Type

export const AskRequest = Schema.Struct({
  /** The search that found nothing, as typed. */
  q: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100)))
})
export type AskRequest = typeof AskRequest.Type

export const SearchMode = Schema.Literals(["japanese", "english", "romaji"])
export type SearchMode = typeof SearchMode.Type

/**
 * How well the results answer the query. `exact`: at least one entry is the word looked up, a
 * form of it, or has every word of the query in a gloss. `weak`: only lookalikes were found
 * (prefixes, typo corrections, a word of the phrase left out), which the app sets apart.
 * `none`: nothing at all.
 */
export const SearchMatch = Schema.Literals(["exact", "weak", "none"])
export type SearchMatch = typeof SearchMatch.Type

/** How the query was read: as Japanese, as English, or as rōmaji for Japanese. */
export const SearchResult = Schema.Struct({
  query: Schema.String,
  mode: SearchMode,
  /** The kana reading searched for, when the query was romaji. */
  reading: Schema.NullOr(Schema.String),
  match: SearchMatch,
  entries: Schema.Array(EntrySummary)
})
export type SearchResult = typeof SearchResult.Type
