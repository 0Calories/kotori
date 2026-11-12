import {
  CAUTION_KINDS,
  CautionKind,
  entries,
  entryFrequency,
  EntryId,
  examples,
  Formality,
  forms,
  LabelCode,
  LabelSeverity,
  LoanLinkMeaning,
  MAX_CAUTIONS,
  proposalRoute,
  proposalStatus,
  SenseOrigin,
  Source,
  tags
} from "@kotori/db"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { Language } from "./Language.ts"

export {
  CAUTION_KINDS,
  CautionKind,
  EntryId,
  Formality,
  LabelCode,
  LabelSeverity,
  LoanLinkMeaning,
  MAX_CAUTIONS,
  SenseOrigin,
  Source
}

const EntryRow = createSelectSchema(entries, { id: EntryId })
// `text` is a bytewise-collated custom column, which derives as unknown.
const FormRow = createSelectSchema(forms, { text: Schema.String })
const ExampleRow = createSelectSchema(examples)

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

/** Another entry a fact points at: the word to compare with, or not to confuse it with. */
export const WordRef = Schema.Struct({
  entryId: EntryId,
  ...Struct.pick(EntryRow.fields, ["headword", "reading"])
})
export type WordRef = typeof WordRef.Type

/**
 * A usage label (casual, respectful, archaic, British…) and where it came from: the dictionary,
 * or Kotori filling a gap the dictionary left. Its severity says how loudly to show it.
 */
export const Label = Schema.Struct({
  code: LabelCode,
  severity: LabelSeverity,
  source: Source
})
export type Label = typeof Label.Type

/** How a sense is used: the dictionary's own note ("usu. to one's subordinate") or Kotori's context beside it. */
export const UsagePattern = Schema.Struct({
  text: Schema.String,
  source: Source,
  /** The word the note compares with, when it names one. */
  about: Schema.NullOr(WordRef)
})
export type UsagePattern = typeof UsagePattern.Type

/** One short teaching where a learner would be surprised, in the learner's language. */
export const EntryCaution = Schema.Struct({
  id: Schema.Int,
  kind: CautionKind,
  text: Schema.String,
  /** The sense it is about; null for the whole word. */
  sense: Schema.NullOr(Schema.Int),
  /** The word to compare with or not to confuse it with. */
  about: Schema.NullOr(WordRef),
  source: Source
})
export type EntryCaution = typeof EntryCaution.Type

/** Multi-signal frequency for an entry; see the `entry_frequency` table. */
export const EntryFrequency = Schema.Struct(
  Struct.pick(createSelectSchema(entryFrequency).fields, ["everyday", "spokenCount", "score"])
)
export type EntryFrequency = typeof EntryFrequency.Type

/** A katakana word and the English word it was borrowed from, read the same from both entries. */
export const LoanLink = Schema.Struct({
  katakana: Schema.String,
  katakanaEntryId: Schema.NullOr(EntryId),
  english: Schema.String,
  englishEntryId: Schema.NullOr(EntryId),
  /** Whether the loan is a true loanword or wasei-eigo; null until a source says. */
  meaning: Schema.NullOr(LoanLinkMeaning),
  /** Who named the pair: JMDict, or Kotori for a pair JMDict doesn't name. */
  source: Source,
  /** Who judged `meaning` (Kotori, for every verdict so far); null with it. */
  meaningSource: Schema.NullOr(Source)
})
export type LoanLink = typeof LoanLink.Type

/**
 * How a similar word differs, read off the two words' labels rather than judged: the respectful
 * or humble form, more casual or formal, the plain word beside a marked one, mostly said by men or
 * by women, the American or British word, older-sounding, or, with no telling label, just a
 * similar meaning. The app words it in the learner's language.
 */
export const SimilarDifference = Schema.Literals([
  "respectful",
  "humble",
  "more_casual",
  "more_formal",
  "plain",
  "masculine",
  "feminine",
  "american",
  "british",
  "older",
  "similar"
])
export type SimilarDifference = typeof SimilarDifference.Type

/** A word close to a sense, from the dictionary's cross-references or a gloss they share. */
export const SimilarWord = Schema.Struct({
  ...WordRef.fields,
  /** What it means where it is like this sense. */
  meaning: Schema.String,
  difference: SimilarDifference,
  /** Whether the dictionary lists it (`xref`) or it only shares a gloss (`gloss`). */
  via: Schema.Literals(["xref", "gloss"])
})
export type SimilarWord = typeof SimilarWord.Type

export const Example = Schema.Struct({
  ...Struct.pick(ExampleRow.fields, ["id", "ja", "furigana", "en", "formality", "note", "noteJa"]),
  /** Kotori wrote it, or it was seeded from Tatoeba or Wiktionary. */
  source: Source,
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
  fields: Schema.Array(Tag),
  info: Schema.Array(Schema.String),
  /** Forms this sense is restricted to; empty means every form. */
  appliesTo: Schema.Array(Schema.String),
  related: Schema.Array(CrossReference),
  antonyms: Schema.Array(CrossReference),
  /** Languages and original words a loanword sense came from (`lsource`). */
  origins: Schema.Array(SenseOrigin),
  examples: Schema.Array(Example),
  /**
   * The labels this sense has beyond the word's (`Entry.labels`, those every sense shares), so a
   * page states each label once.
   */
  labels: Schema.Array(Label),
  usagePatterns: Schema.Array(UsagePattern),
  /** Words close to this sense, each listed under the first sense it is close to. */
  similarWords: Schema.Array(SimilarWord)
})
export type Sense = typeof Sense.Type

export const EnrichmentStatus = Schema.Literals(["ready", "queued", "unavailable"])
export type EnrichmentStatus = typeof EnrichmentStatus.Type

/** Whether the worker's jobs for an entry are done, on their way, or not coming (no provider, or failed). */
export const Enrichment = Schema.Struct({
  examples: EnrichmentStatus,
  audio: EnrichmentStatus
})
export type Enrichment = typeof Enrichment.Type

/** One spoken headword clip and who reads it. */
export const EntryAudio = Schema.Struct({
  url: Schema.String,
  /** Kotori voice id from the voices list, e.g. "ja-kyoko"; null for legacy clips. */
  voice: Schema.NullOr(Schema.String),
  voiceName: Schema.NullOr(Schema.String)
})
export type EntryAudio = typeof EntryAudio.Type

/**
 * A word in the learner's target language, explained in their own: a Japanese word from
 * JMDict for Japanese learners, an English word for English learners.
 */
export const Entry = Schema.Struct({
  ...Struct.pick(EntryRow.fields, ["id", "language", "source", "headword", "reading", "common"]),
  /** The kana reading in rōmaji; empty for English words. */
  romaji: Schema.String,
  /** Usually written in kana (JMDict's `uk`): a spelling fact, not a register label. */
  usuallyKana: Schema.Boolean,
  /**
   * The word's labels: those every sense carries. A single-sense word's are its sense's; one sense
   * of several never speaks for the others.
   */
  labels: Schema.Array(Label),
  /** Null when no source gives frequency signals for the word. */
  frequency: Schema.NullOr(EntryFrequency),
  /** The katakana loan and its English word, from whichever end this entry is. */
  loanLink: Schema.NullOr(LoanLink),
  /** At most three, word-level and sense-scoped together, first first. */
  cautions: Schema.Array(EntryCaution),
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
  ...Struct.pick(EntryRow.fields, ["id", "language", "headword", "reading", "common"]),
  romaji: Schema.String,
  meanings: Schema.Array(Schema.String),
  partOfSpeech: Schema.NullOr(Schema.String),
  /** The word's labels, as on `Entry`: those every sense carries. The app picks the one or two worth a chip. */
  labels: Schema.Array(Label),
  /** Inflections undone to find this entry, e.g. ["polite", "past"] for 食べました or ["past"] for "ate". */
  inflection: Schema.Array(Schema.String),
  /** The first headword clip, so results can be heard without opening the entry; null until voiced. */
  audioUrl: Schema.NullOr(Schema.String)
})
export type EntrySummary = typeof EntrySummary.Type

/** A drafted sense, as an entry's sense reads: its labels (only those it adds), usage patterns, all Kotori's. */
export const DraftSense = Schema.Struct({
  index: Schema.Int,
  glosses: Schema.Array(Schema.String),
  partsOfSpeech: Schema.Array(Tag),
  labels: Schema.Array(Label),
  usagePatterns: Schema.Array(UsagePattern)
})
export type DraftSense = typeof DraftSense.Type

/**
 * Kotori's draft of an entry, in the entry's own model and read the same way: the word's labels
 * (those every sense carries), senses, and cautions. Unverified until the admin approves it, when it
 * becomes an entry with these same facts.
 */
export const DraftEntry = Schema.Struct({
  ...Struct.pick(EntryRow.fields, ["headword", "reading"]),
  spellings: Schema.Array(Schema.String),
  /** How commonly natives use it today, 1–5; a draft has no other frequency signals. */
  frequency: Schema.Int,
  labels: Schema.Array(Label),
  senses: Schema.Array(DraftSense),
  cautions: Schema.Array(EntryCaution)
})
export type DraftEntry = typeof DraftEntry.Type

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
