import {
  CAUTION_KINDS,
  CautionKind,
  entries,
  entryFrequency,
  EntryId,
  EntryReview,
  examples,
  Formality,
  forms,
  LabelCode,
  LabelSeverity,
  LoanLinkMeaning,
  MAX_CAUTIONS,
  proposalRoute,
  proposalStatus,
  REVIEW_RULES,
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
  EntryReview,
  Formality,
  LabelCode,
  LabelSeverity,
  LoanLinkMeaning,
  MAX_CAUTIONS,
  REVIEW_RULES,
  SenseOrigin,
  Source
}

const EntryRow = createSelectSchema(entries, { id: EntryId })
// `text` is a bytewise-collated custom column, which `createSelectSchema` derives as `unknown`.
const FormRow = createSelectSchema(forms, { text: Schema.String })
const ExampleRow = createSelectSchema(examples)

export const Tag = createSelectSchema(tags)
export type Tag = typeof Tag.Type

export const Form = Schema.Struct({
  ...Struct.pick(FormRow.fields, ["text", "kind", "common"]),
  tags: Schema.Array(Tag)
})
export type Form = typeof Form.Type

export const CrossReference = Schema.Struct({
  text: Schema.String,
  entryId: Schema.NullOr(EntryId)
})
export type CrossReference = typeof CrossReference.Type

export const WordRef = Schema.Struct({
  entryId: EntryId,
  ...Struct.pick(EntryRow.fields, ["headword", "reading"])
})
export type WordRef = typeof WordRef.Type

export const Label = Schema.Struct({
  code: LabelCode,
  severity: LabelSeverity,
  source: Source
})
export type Label = typeof Label.Type

export const UsagePattern = Schema.Struct({
  text: Schema.String,
  source: Source,
  about: Schema.NullOr(WordRef)
})
export type UsagePattern = typeof UsagePattern.Type

export const EntryCaution = Schema.Struct({
  id: Schema.Int,
  kind: CautionKind,
  text: Schema.String,
  sense: Schema.NullOr(Schema.Int),
  about: Schema.NullOr(WordRef),
  source: Source
})
export type EntryCaution = typeof EntryCaution.Type

export const EntryFrequency = Schema.Struct(
  Struct.pick(createSelectSchema(entryFrequency).fields, ["everyday", "spokenCount", "score"])
)
export type EntryFrequency = typeof EntryFrequency.Type

export const LoanLink = Schema.Struct({
  katakana: Schema.String,
  katakanaEntryId: Schema.NullOr(EntryId),
  english: Schema.String,
  englishEntryId: Schema.NullOr(EntryId),
  meaning: Schema.NullOr(LoanLinkMeaning),
  source: Source,
  meaningSource: Schema.NullOr(Source)
})
export type LoanLink = typeof LoanLink.Type

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

export const SimilarWord = Schema.Struct({
  ...WordRef.fields,
  meaning: Schema.String,
  difference: SimilarDifference,
  via: Schema.Literals(["xref", "gloss"])
})
export type SimilarWord = typeof SimilarWord.Type

export const Example = Schema.Struct({
  ...Struct.pick(ExampleRow.fields, ["id", "ja", "furigana", "en", "formality", "note", "noteJa"]),
  source: Source,
  audioUrl: Schema.NullOr(Schema.String),
  translationAudioUrl: Schema.NullOr(Schema.String)
})
export type Example = typeof Example.Type

export const Sense = Schema.Struct({
  index: Schema.Int,
  glosses: Schema.Array(Schema.String),
  partsOfSpeech: Schema.Array(Tag),
  fields: Schema.Array(Tag),
  info: Schema.Array(Schema.String),
  appliesTo: Schema.Array(Schema.String),
  related: Schema.Array(CrossReference),
  antonyms: Schema.Array(CrossReference),
  origins: Schema.Array(SenseOrigin),
  examples: Schema.Array(Example),
  labels: Schema.Array(Label),
  usagePatterns: Schema.Array(UsagePattern),
  similarWords: Schema.Array(SimilarWord)
})
export type Sense = typeof Sense.Type

export const EnrichmentStatus = Schema.Literals(["ready", "unrequested", "queued", "unavailable"])
export type EnrichmentStatus = typeof EnrichmentStatus.Type

export const Enrichment = Schema.Struct({
  examples: EnrichmentStatus,
  audio: EnrichmentStatus
})
export type Enrichment = typeof Enrichment.Type

export const EntryAudio = Schema.Struct({
  url: Schema.String,
  voice: Schema.NullOr(Schema.String),
  voiceName: Schema.NullOr(Schema.String)
})
export type EntryAudio = typeof EntryAudio.Type

export const Entry = Schema.Struct({
  ...Struct.pick(EntryRow.fields, ["id", "language", "source", "headword", "reading", "common"]),
  review: EntryReview,
  romaji: Schema.String,
  usuallyKana: Schema.Boolean,
  labels: Schema.Array(Label),
  frequency: Schema.NullOr(EntryFrequency),
  loanLink: Schema.NullOr(LoanLink),
  cautions: Schema.Array(EntryCaution),
  forms: Schema.Array(Form),
  senses: Schema.Array(Sense),
  audioUrl: Schema.NullOr(Schema.String),
  audio: Schema.Array(EntryAudio),
  enrichment: Enrichment
})
export type Entry = typeof Entry.Type

export const EntrySummary = Schema.Struct({
  ...Struct.pick(EntryRow.fields, ["id", "language", "headword", "reading", "common"]),
  review: EntryReview,
  romaji: Schema.String,
  meanings: Schema.Array(Schema.String),
  partOfSpeech: Schema.NullOr(Schema.String),
  labels: Schema.Array(Label),
  inflection: Schema.Array(Schema.String),
  audioUrl: Schema.NullOr(Schema.String)
})
export type EntrySummary = typeof EntrySummary.Type

export const DraftSense = Schema.Struct({
  index: Schema.Int,
  glosses: Schema.Array(Schema.String),
  partsOfSpeech: Schema.Array(Tag),
  labels: Schema.Array(Label),
  usagePatterns: Schema.Array(UsagePattern)
})
export type DraftSense = typeof DraftSense.Type

export const DraftEntry = Schema.Struct({
  ...Struct.pick(EntryRow.fields, ["headword", "reading"]),
  id: EntryId,
  spellings: Schema.Array(Schema.String),
  frequency: Schema.Int,
  labels: Schema.Array(Label),
  senses: Schema.Array(DraftSense),
  cautions: Schema.Array(EntryCaution)
})
export type DraftEntry = typeof DraftEntry.Type

export const DRAFT_STANDING = {
  unreviewed: "pending",
  approved: "approved",
  discarded: "discarded",
  gone: "removed"
} as const satisfies Record<EntryReview | "gone", string>

type Answered = Exclude<(typeof proposalStatus.enumValues)[number], "drafted">

export const ProposalStatus = Schema.Literals([
  ...proposalStatus.enumValues.filter((status): status is Answered => status !== "drafted"),
  ...Object.values(DRAFT_STANDING)
])
export type ProposalStatus = typeof ProposalStatus.Type

export const ProposalRoute = createSelectSchema(proposalRoute)
export type ProposalRoute = typeof ProposalRoute.Type

export const ProposalId = Schema.Int.pipe(Schema.brand("ProposalId"))
export type ProposalId = typeof ProposalId.Type

export const Proposal = Schema.Struct({
  id: ProposalId,
  query: Schema.String,
  language: Language,
  status: ProposalStatus,
  draft: Schema.NullOr(DraftEntry),
  linked: Schema.NullOr(EntrySummary),
  reason: Schema.NullOr(Schema.String),
  route: Schema.NullOr(ProposalRoute)
})
export type Proposal = typeof Proposal.Type

export const AskRequest = Schema.Struct({
  q: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100)))
})
export type AskRequest = typeof AskRequest.Type

export const SearchMode = Schema.Literals(["japanese", "english", "romaji"])
export type SearchMode = typeof SearchMode.Type

export const SearchMatch = Schema.Literals(["exact", "weak", "none"])
export type SearchMatch = typeof SearchMatch.Type

export const SearchResult = Schema.Struct({
  query: Schema.String,
  mode: SearchMode,
  reading: Schema.NullOr(Schema.String),
  match: SearchMatch,
  entries: Schema.Array(EntrySummary)
})
export type SearchResult = typeof SearchResult.Type
