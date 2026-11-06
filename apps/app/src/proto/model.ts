/**
 * PROTOTYPE. The proposed dictionary data model, as the app would read it. Nothing here is served
 * by the API; `mock.ts` holds hand-written entries so the entry page can be judged on real words
 * before the schema changes. Delete with `app/proto` once the decision is made.
 */

export type Language = "ja" | "en"

/** Where a fact came from. Inference never overwrites a dictionary source. */
export type Source = "jmdict" | "jawiktionary" | "enwiktionary" | "tatoeba" | "kotori" | "user"

/**
 * One vocabulary for the dictionary's usage codes and Kotori's fills. JMDict's codes where it has
 * them (col, hon, male…), the English dictionary's regions, and Kotori's `form` fill.
 */
export type LabelCode =
  | "col"
  | "sl"
  | "net-sl"
  | "fam"
  | "vulg"
  | "X"
  | "derog"
  | "joc"
  | "euph"
  | "hon"
  | "hum"
  | "pol"
  | "form"
  | "poet"
  | "male"
  | "fem"
  | "chn"
  | "arch"
  | "obs"
  | "dated"
  | "hist"
  | "rare"
  | "id"
  | "on-mim"
  | "abbr"
  | "wasei"
  | "uncountable"
  | "en-US"
  | "en-GB"
  | "en-AU"
  | "ksb"

export interface Label {
  readonly code: LabelCode
  readonly source: Source
}

/**
 * A usage note on a sense: JMDict's `s_inf`, the curated file's `info`, or context Kotori adds
 * beside them. Kotori's notes are drawn apart so the learner knows which is the dictionary's.
 */
export interface Pattern {
  readonly text: string
  readonly source: Source
  /** A word to compare with, when the note names one. */
  readonly about?: number
}

export type Formality = "vulgar" | "casual" | "neutral" | "polite" | "formal"

export interface Example {
  readonly id: number
  readonly ja: string
  /** `{漢字|かんじ}` furigana; equal to `ja` on English entries. */
  readonly furigana: string
  readonly en: string
  readonly formality: Formality
  readonly source: Source
  /** Whether a clip exists; the prototype never plays one. */
  readonly audio: boolean
}

/**
 * What would surprise a learner. The kinds differ by direction: English natives learning Japanese
 * meet politeness traps, Japanese natives learning English meet katakana false friends. Grammar
 * details (countability, transitivity) are labels with an explanation, not pitfalls.
 */
export type PitfallKind =
  // Learning Japanese
  | "rude_upward"
  | "keigo_direction"
  | "set_phrase"
  | "particle_pattern"
  | "gendered_speech"
  // Learning English
  | "false_friend"
  | "textbook_english"
  | "directness"
  | "variety"
  // Both
  | "confusable"
  | "collocation"

export interface Pitfall {
  readonly id: number
  readonly kind: PitfallKind
  /** In the learner's language: English on a Japanese word, Japanese on an English one. */
  readonly text: string
  /** The sense it is about; null for the whole word. */
  readonly sense: number | null
  /** The word to compare with or avoid confusing, when there is one. */
  readonly about?: number
  readonly source: Source
}

/** Deterministic evidence of use, from the seeds. Null where no source speaks. */
export interface UsageEvidence {
  /** JMDict's ichi1 list for Japanese; the top of the subtitle list for English. */
  readonly everyday: boolean
  /** OpenSubtitles count for English words; null for Japanese until a tokenised corpus exists. */
  readonly spokenCount: number | null
  /** The curated English file's 1–5 rating, for phrases the subtitle list can't count. */
  readonly familiarity: number | null
}

/**
 * A katakana word and the English word it was borrowed from: one fact, stored once, read from both
 * entries. JMDict's `lsource` names the pair; Kotori judges whether the meaning drifted.
 */
export interface LoanLink {
  readonly katakana: string
  readonly katakanaEntryId: number | null
  readonly english: string
  readonly englishEntryId: number | null
  readonly meaning: "same" | "divergent" | null
  readonly source: Source
}

export interface Form {
  readonly text: string
  readonly kind: "kanji" | "kana" | "spelling" | "inflection"
  /** JMDict `rK`/`sK` etc.; an inflection's name on English words. */
  readonly tags: ReadonlyArray<string>
}

export interface Sense {
  readonly index: number
  readonly glosses: ReadonlyArray<string>
  /** Short part-of-speech labels, already human-readable for the prototype. */
  readonly pos: ReadonlyArray<string>
  readonly fields: ReadonlyArray<string>
  readonly labels: ReadonlyArray<Label>
  readonly patterns: ReadonlyArray<Pattern>
  readonly examples: ReadonlyArray<Example>
  /** Cross-references the dictionary lists; a near-synonym list is derived from these plus labels. */
  readonly similar: ReadonlyArray<number>
  readonly antonyms: ReadonlyArray<number>
}

export interface Entry {
  readonly id: number
  readonly language: Language
  readonly headword: string
  readonly reading: string
  readonly romaji: string
  readonly forms: ReadonlyArray<Form>
  /** Usually written in kana (JMDict `uk`): a spelling fact, not a register label. */
  readonly usuallyKana: boolean
  readonly common: boolean
  readonly dictionary: Source
  readonly evidence: UsageEvidence
  readonly loan: LoanLink | null
  readonly senses: ReadonlyArray<Sense>
  readonly pitfalls: ReadonlyArray<Pitfall>
  /** A headword clip exists. */
  readonly audio: boolean
  /** What the prototype case is for; shown on the index, not on the entry. */
  readonly tests: string
}
