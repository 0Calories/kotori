import type { EntryRecord, SenseRecord } from "@kotori/contracts"
import { type EntryReview, isLabelCode, type LabelCode, type Source } from "@kotori/db"

export interface SeedExample {
  readonly ja: string
  readonly en: string
  readonly source: Extract<Source, "tatoeba" | "jawiktionary" | "enwiktionary">
}

export interface SeedFrequency {
  readonly everyday: boolean
  readonly spokenCount: number | null
  readonly score: number | null
}

export interface ImportSense extends SenseRecord {
  readonly examples?: ReadonlyArray<SeedExample> | undefined
}

export interface ImportEntry extends Omit<EntryRecord, "senses"> {
  readonly senses: ReadonlyArray<ImportSense>
  readonly frequency?: SeedFrequency | null | undefined
  readonly review?: EntryReview | undefined
}

export const SEED_SOURCES = [
  "jmdict",
  "jawiktionary",
  "enwiktionary",
  "tatoeba"
] as const satisfies ReadonlyArray<Source>

export const labelsOf = (sense: SenseRecord): Array<LabelCode> => {
  const codes = new Set<LabelCode>()
  for (const code of [...sense.misc, ...sense.dialects]) if (isLabelCode(code)) codes.add(code)
  if (sense.wasei) codes.add("wasei")
  return [...codes]
}

export const usagePatternsOf = (sense: SenseRecord): Array<string> => {
  const seen = new Set<string>()
  return sense.info.map((text) => text.trim()).filter((text) => text.length > 0 && !seen.has(text) && seen.add(text))
}

export const speaks = (frequency: SeedFrequency | null | undefined): frequency is SeedFrequency =>
  frequency != null && (frequency.everyday || frequency.spokenCount !== null || frequency.score !== null)
