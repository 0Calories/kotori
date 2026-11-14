import type { EntryRecord, SenseRecord } from "@kotori/contracts"
import { type EntryReview, isLabelCode, type LabelCode, type Source } from "@kotori/db"

/**
 * What the seed sources say about using a word, beyond its forms and senses: read by the
 * importers with no model calls, and written by `insertEntries` beside the entry. Labels and
 * usage patterns are read from the sense record itself (`misc`, `dialects`, `wasei`, `info`); example
 * sentences and frequency signals ride along on the records the importers build.
 */

/** A sentence pair a seed source gives for a sense: Tatoeba's through JMDict, or Wiktionary's. */
export interface SeedExample {
  readonly ja: string
  readonly en: string
  readonly source: Extract<Source, "tatoeba" | "jawiktionary" | "enwiktionary">
}

/** Multi-signal frequency from the seed sources; see the `entry_frequency` table. */
export interface SeedFrequency {
  readonly everyday: boolean
  readonly spokenCount: number | null
  readonly score: number | null
}

export interface ImportSense extends SenseRecord {
  readonly examples?: ReadonlyArray<SeedExample> | undefined
}

/**
 * An entry as an importer builds it. A stored `EntryRecord` is one too, with no examples or
 * frequency signals: re-inserting it (an alias joining its forms) leaves the seeded ones alone.
 */
export interface ImportEntry extends Omit<EntryRecord, "senses"> {
  readonly senses: ReadonlyArray<ImportSense>
  readonly frequency?: SeedFrequency | null | undefined
  /** `unreviewed` for an entry Kotori drafted; every imported entry is approved. */
  readonly review?: EntryReview | undefined
}

/** The sources whose facts a seed import rebuilds; Kotori's and learners' are layered on top. */
export const SEED_SOURCES = [
  "jmdict",
  "jawiktionary",
  "enwiktionary",
  "tatoeba"
] as const satisfies ReadonlyArray<Source>

/**
 * A sense's usage labels, in the label vocabulary: its `misc` codes and dialects that are labels,
 * and `wasei` for JMDict's wasei-eigo mark. Codes outside the vocabulary are left out.
 */
export const labelsOf = (sense: SenseRecord): Array<LabelCode> => {
  const codes = new Set<LabelCode>()
  for (const code of [...sense.misc, ...sense.dialects]) if (isLabelCode(code)) codes.add(code)
  if (sense.wasei) codes.add("wasei")
  return [...codes]
}

/** A sense's usage patterns: the dictionary's own notes (`s_inf`, the English dictionary's `info`). */
export const usagePatternsOf = (sense: SenseRecord): Array<string> => {
  const seen = new Set<string>()
  return sense.info.map((text) => text.trim()).filter((text) => text.length > 0 && !seen.has(text) && seen.add(text))
}

/** Whether frequency signals say anything beyond the prior; an entry with none gets no row. */
export const speaks = (frequency: SeedFrequency | null | undefined): frequency is SeedFrequency =>
  frequency != null && (frequency.everyday || frequency.spokenCount !== null || frequency.score !== null)
