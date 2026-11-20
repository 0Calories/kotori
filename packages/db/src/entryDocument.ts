import * as Schema from "effect/Schema"
import { Formality, Source } from "./columns.ts"

/**
 * Deterministic source-prefixed string identifier for a dictionary entry:
 * - `jmdict:<ent_seq>` for JMDict Japanese entries
 * - `en:<primary-form>` (case-preserving) for English entries
 * - `kotori:<id>` for Kotori-created entries
 */
export const EntryId = Schema.String.pipe(Schema.brand("EntryId"))
export type EntryId = typeof EntryId.Type

export const KOTORI_ENTRY_PREFIX = "kotori:"
const ENTRY_ID_PREFIXES = ["jmdict:", "en:", KOTORI_ENTRY_PREFIX] as const

export const jmdictEntryId = (seq: string | number): EntryId => EntryId.make(`jmdict:${seq}`)
export const englishEntryId = (headword: string): EntryId => EntryId.make(`en:${headword}`)
export const kotoriEntryId = (id: string): EntryId => EntryId.make(`${KOTORI_ENTRY_PREFIX}${id}`)
export const isEntryId = (value: string): value is EntryId =>
  ENTRY_ID_PREFIXES.some((prefix) => value.startsWith(prefix) && value.length > prefix.length)
export const isKotoriEntryId = (value: string): value is EntryId =>
  value.startsWith(KOTORI_ENTRY_PREFIX) && value.length > KOTORI_ENTRY_PREFIX.length
export const isExternalEntryId = (id: EntryId): boolean => id.startsWith("jmdict:") || id.startsWith("en:")

export const FORM_KINDS = ["kanji", "kana", "spelling", "inflection"] as const
export const FormKind = Schema.Literals(FORM_KINDS)
export type FormKind = typeof FormKind.Type

/**
 * The language (ISO 639-2B code from JMDict's `lsource`, e.g. `"eng"`, `"fre"`) and original word
 * a loanword or wasei-eigo sense came from: French `"jupon"` for ズボン, English `"convenience store"`
 * for コンビニ. `word` is null when JMDict names only the language.
 */
export const SenseOrigin = Schema.Struct({
  language: Schema.String,
  word: Schema.NullOr(Schema.String)
})
export type SenseOrigin = typeof SenseOrigin.Type

/**
 * How loudly a label is shown: `avoid` (don't say it), `warning` (only in the right company),
 * `info` (worth knowing), `quiet` (a grammar or spelling fact, explained on tap).
 */
export const LabelSeverity = Schema.Literals(["avoid", "warning", "info", "quiet"])
export type LabelSeverity = typeof LabelSeverity.Type

/**
 * One vocabulary for usage labels, each with its severity: JMDict's `misc` codes, which the
 * English dictionary also uses, JMDict's dialects, the English dictionary's regions and
 * countability, and Kotori's `form` fill for formal written words the dictionary leaves untagged.
 */
export const LABEL_SEVERITY = {
  vulg: "avoid",
  X: "avoid",
  derog: "avoid",
  arch: "avoid",
  obs: "avoid",
  col: "warning",
  sl: "warning",
  "net-sl": "warning",
  fam: "warning",
  joc: "warning",
  euph: "warning",
  male: "warning",
  fem: "warning",
  chn: "warning",
  dated: "warning",
  hist: "warning",
  rare: "warning",
  "m-sl": "warning",
  sens: "warning",
  nonstd: "warning",
  hon: "info",
  hum: "info",
  pol: "info",
  form: "info",
  poet: "info",
  // JMDict's dialects
  ksb: "info",
  osb: "info",
  ktb: "info",
  kyb: "info",
  kyu: "info",
  hob: "info",
  thb: "info",
  tsb: "info",
  tsug: "info",
  rkb: "info",
  nab: "info",
  bra: "info",
  // The English dictionary's regions
  "en-US": "info",
  "en-GB": "info",
  "en-AU": "info",
  "en-CA": "info",
  "en-NZ": "info",
  "en-IE": "info",
  "en-scotland": "info",
  "en-IN": "info",
  "en-PH": "info",
  "en-SG": "info",
  "en-ZA": "info",
  id: "quiet",
  "on-mim": "quiet",
  abbr: "quiet",
  proverb: "quiet",
  yoji: "quiet",
  wasei: "quiet",
  uncountable: "quiet"
} as const satisfies Record<string, LabelSeverity>

export const LabelCode = Schema.Literals(
  Object.keys(LABEL_SEVERITY) as [keyof typeof LABEL_SEVERITY, ...Array<keyof typeof LABEL_SEVERITY>]
)
export type LabelCode = typeof LabelCode.Type

export const labelSeverity = (code: LabelCode): LabelSeverity => LABEL_SEVERITY[code]

export const isLabelCode = (code: string): code is LabelCode => Object.hasOwn(LABEL_SEVERITY, code)

/**
 * What would surprise a learner. The kinds differ by direction: Japanese learners meet
 * politeness pitfalls, English learners meet katakana wasei-eigo; `confusable`, `collocation`
 * and `tone` meet both.
 */
export const CautionKind = Schema.Literals([
  // Learning Japanese
  "rude_upward",
  "keigo_direction",
  "set_phrase",
  "particle_pattern",
  "gendered_speech",
  // Learning English
  "wasei_eigo",
  "textbook_english",
  "directness",
  "variety",
  // Both
  "confusable",
  "collocation",
  "tone"
])
export type CautionKind = typeof CautionKind.Type

export const CAUTION_KINDS: Readonly<Record<"ja" | "en", ReadonlyArray<CautionKind>>> = {
  ja: [
    "rude_upward",
    "keigo_direction",
    "set_phrase",
    "particle_pattern",
    "gendered_speech",
    "confusable",
    "collocation",
    "tone"
  ],
  en: ["wasei_eigo", "textbook_english", "directness", "variety", "confusable", "collocation", "tone"]
}

/** A word carries at most this many cautions. */
export const MAX_CAUTIONS = 3

/** Whether a katakana loan is a true loanword with the exact same meaning (アドバイス) or wasei-eigo (マンション, コンビニ). */
export const LoanLinkMeaning = Schema.Literals(["true_loanword", "wasei_eigo"])
export type LoanLinkMeaning = typeof LoanLinkMeaning.Type

/** Who would plausibly say an example sentence: "unspecified" when nothing in it suggests one. */
export const SpeakerGender = Schema.Literals(["masculine", "feminine", "unspecified"])
export type SpeakerGender = typeof SpeakerGender.Type

export const SpeakerAge = Schema.Literals(["child", "youth", "adult", "middle-aged", "older", "unspecified"])
export type SpeakerAge = typeof SpeakerAge.Type

/** Conversation (someone talking to someone), announcement (news, notices, mail read aloud) or narration (prose). */
export const SentenceMedium = Schema.Literals(["conversation", "announcement", "narration"])
export type SentenceMedium = typeof SentenceMedium.Type

/** The dominant feel of the delivery; "humorous" sends a sentence to a comic voice, the rest is kept for voice settings. */
export const SentenceTone = Schema.Literals(["neutral", "cheerful", "serious", "gentle", "rough", "humorous"])
export type SentenceTone = typeof SentenceTone.Type

/** Who would say an example sentence, and how: what voice casting reads beside its formality. */
export const Casting = Schema.Struct({
  speakerGender: SpeakerGender,
  speakerAge: SpeakerAge,
  medium: Schema.NullOr(SentenceMedium),
  /** Regional variety label such as "kansai" or "british"; null for the language's default. */
  variety: Schema.NullOr(Schema.String),
  tone: Schema.NullOr(SentenceTone)
})
export type Casting = typeof Casting.Type

// ---------------------------------------------------------------------------
// Document JSONB shapes: `entries.base` and `entries.enrichment`
// ---------------------------------------------------------------------------

export const BaseGloss = Schema.Struct({
  text: Schema.String,
  type: Schema.NullOr(Schema.String)
})
export type BaseGloss = typeof BaseGloss.Type

export const BaseForm = Schema.Struct({
  kind: FormKind,
  text: Schema.String,
  common: Schema.Boolean,
  tags: Schema.Array(Schema.String),
  priorities: Schema.Array(Schema.String),
  restrictions: Schema.Array(Schema.String),
  noKanji: Schema.Boolean
})
export type BaseForm = typeof BaseForm.Type

export const BaseLabel = Schema.Struct({
  code: LabelCode,
  source: Source
})
export type BaseLabel = typeof BaseLabel.Type

export const BaseUsagePattern = Schema.Struct({
  text: Schema.String,
  source: Source,
  aboutEntryId: Schema.optional(Schema.NullOr(EntryId))
})
export type BaseUsagePattern = typeof BaseUsagePattern.Type

export const BaseExample = Schema.Struct({
  ja: Schema.String,
  furigana: Schema.String,
  en: Schema.String,
  source: Source
})
export type BaseExample = typeof BaseExample.Type

export const BaseSense = Schema.Struct({
  glosses: Schema.Array(BaseGloss),
  pos: Schema.Array(Schema.String),
  misc: Schema.Array(Schema.String),
  fields: Schema.Array(Schema.String),
  dialects: Schema.Array(Schema.String),
  info: Schema.Array(Schema.String),
  stagk: Schema.Array(Schema.String),
  stagr: Schema.Array(Schema.String),
  xrefs: Schema.Array(Schema.String),
  antonyms: Schema.Array(Schema.String),
  origins: Schema.Array(SenseOrigin),
  wasei: Schema.Boolean,
  labels: Schema.optional(Schema.Array(BaseLabel)),
  usagePatterns: Schema.optional(Schema.Array(BaseUsagePattern)),
  examples: Schema.optional(Schema.Array(BaseExample))
})
export type BaseSense = typeof BaseSense.Type

export const BaseFrequency = Schema.Struct({
  everyday: Schema.Boolean,
  spokenCount: Schema.NullOr(Schema.Int),
  score: Schema.NullOr(Schema.Int)
})
export type BaseFrequency = typeof BaseFrequency.Type

export const BaseLoanLink = Schema.Struct({
  katakana: Schema.String,
  katakanaEntryId: Schema.NullOr(EntryId),
  english: Schema.String,
  englishEntryId: Schema.NullOr(EntryId),
  meaning: Schema.NullOr(LoanLinkMeaning),
  source: Source,
  meaningSource: Schema.NullOr(Source)
})
export type BaseLoanLink = typeof BaseLoanLink.Type

export const BaseCaution = Schema.Struct({
  sense: Schema.NullOr(Schema.Int),
  kind: CautionKind,
  text: Schema.String,
  aboutEntryId: Schema.NullOr(EntryId),
  source: Source
})
export type BaseCaution = typeof BaseCaution.Type

/**
 * Deterministic Source facts stored in `entries.base`: everything read from JMDict, Wiktionary,
 * Tatoeba, or authored as a Kotori entry's own definition. Changing nested shapes here requires
 * zero SQL DDL migrations.
 */
export const EntryBase = Schema.Struct({
  headword: Schema.String,
  reading: Schema.String,
  forms: Schema.Array(BaseForm),
  senses: Schema.Array(BaseSense),
  frequency: Schema.optional(Schema.NullOr(BaseFrequency)),
  loanLink: Schema.optional(Schema.NullOr(BaseLoanLink)),
  cautions: Schema.optional(Schema.Array(BaseCaution))
})
export type EntryBase = typeof EntryBase.Type

export const EnrichedExample = Schema.Struct({
  sense: Schema.Int,
  ja: Schema.String,
  furigana: Schema.String,
  en: Schema.String,
  formality: Schema.NullOr(Formality),
  note: Schema.NullOr(Schema.String),
  noteJa: Schema.optional(Schema.NullOr(Schema.String)),
  casting: Schema.optional(Schema.NullOr(Casting)),
  source: Source,
  model: Schema.NullOr(Schema.String),
  createdAt: Schema.String
})
export type EnrichedExample = typeof EnrichedExample.Type

export const EnrichedLabel = Schema.Struct({
  sense: Schema.Int,
  code: LabelCode,
  source: Source
})
export type EnrichedLabel = typeof EnrichedLabel.Type

export const EnrichedUsagePattern = Schema.Struct({
  sense: Schema.Int,
  text: Schema.String,
  source: Source,
  aboutEntryId: Schema.NullOr(EntryId)
})
export type EnrichedUsagePattern = typeof EnrichedUsagePattern.Type

/**
 * Optional AI Enrichment stored in `entries.enrichment`. Defaults to `null` and can be wiped
 * instantaneously with `UPDATE entries SET enrichment = NULL` without touching `base` or
 * `entry_search`.
 */
export const EntryEnrichment = Schema.Struct({
  examples: Schema.optional(Schema.Array(EnrichedExample)),
  cautions: Schema.optional(Schema.Array(BaseCaution)),
  labels: Schema.optional(Schema.Array(EnrichedLabel)),
  usagePatterns: Schema.optional(Schema.Array(EnrichedUsagePattern)),
  loanLink: Schema.optional(Schema.NullOr(BaseLoanLink))
})
export type EntryEnrichment = typeof EntryEnrichment.Type
