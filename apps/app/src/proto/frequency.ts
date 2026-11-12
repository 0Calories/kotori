import type { Entry, EntrySummary, Label, LabelCode, Language } from "@kotori/contracts"
import type { Strings } from "../i18n/strings.ts"
import { type ChipItem, labelItems, loanChip } from "../lib/entry.ts"

/**
 * PROTOTYPE: Five-tier frequency model (`very_common` 4/4, `common` 3/4, `uncommon` 2/4,
 * `rare` 1/4, `archaic` 0/4) for entry headboards and search rows. Kept in `src/proto/` until
 * `EntrySummary` and backend frequency scoring are planned for the full feature.
 */
export type FrequencyTier = "very_common" | "common" | "uncommon" | "rare" | "archaic"

export const FREQUENCY_TIERS: ReadonlyArray<FrequencyTier> = ["very_common", "common", "uncommon", "rare", "archaic"]

export const FREQUENCY_LEVEL: Record<FrequencyTier, 0 | 1 | 2 | 3 | 4> = {
  archaic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  very_common: 4
}

const FREQUENCY_COPY: Record<Language, Record<FrequencyTier, { readonly label: string; readonly help: string }>> = {
  en: {
    very_common: {
      label: "Very common",
      help: "Core everyday vocabulary — one of the words native speakers reach for first."
    },
    common: {
      label: "Common",
      help: "Used regularly in conversation and writing."
    },
    uncommon: {
      label: "Uncommon",
      help: "Understood by native speakers, though heard less often in everyday talk — check whether a simpler word fits first."
    },
    rare: {
      label: "Rare",
      help: "People recognise it, especially in formal writing, but seldom say it aloud."
    },
    archaic: {
      label: "Archaic",
      help: "Found in old texts and period drama, not in modern speech. Recognise it; don't say it."
    }
  },
  ja: {
    very_common: {
      label: "とてもよく使う",
      help: "ネイティブが毎日のように真っ先に使う基本的な言葉です。"
    },
    common: {
      label: "よく使う",
      help: "日常会話や読み書きでよく使われる言葉です。"
    },
    uncommon: {
      label: "やや少なめ",
      help: "意味は通じますが、普段の会話ではやや聞く頻度が下がる言葉です。"
    },
    rare: {
      label: "まれ",
      help: "意味は通じますが、日常ではめったに口にしません。"
    },
    archaic: {
      label: "古語",
      help: "古い文章では見かけますが、今は使いません。読めれば十分です。"
    }
  }
}

const OLD_LABELS: ReadonlyArray<LabelCode> = ["arch", "obs"]
const FREQUENCY_REDUNDANT_LABELS: ReadonlyArray<LabelCode> = ["arch", "obs", "rare"]

/** Strips `arch`/`obs`/`rare` usage labels when a dedicated Frequency Snow Pebble already leads the row. */
export const withoutRedundantFrequencyLabels = (labels: ReadonlyArray<Label>): ReadonlyArray<Label> =>
  labels.filter((label) => !FREQUENCY_REDUNDANT_LABELS.includes(label.code))

export const isFrequencyChipKey = (key: string): key is `freq:${FrequencyTier}` =>
  key === "freq:very_common" ||
  key === "freq:common" ||
  key === "freq:uncommon" ||
  key === "freq:rare" ||
  key === "freq:archaic"

export const tierFromChipKey = (key: `freq:${FrequencyTier}`): FrequencyTier =>
  key.slice("freq:".length) as FrequencyTier

export const frequencyTierChip = (uiLanguage: Language, tier: FrequencyTier): ChipItem => {
  const copy = FREQUENCY_COPY[uiLanguage][tier]
  const severity = tier === "archaic" ? "avoid" : tier === "rare" ? "warning" : tier === "uncommon" ? "quiet" : "info"
  return {
    key: `freq:${tier}`,
    label: copy.label,
    help: copy.help,
    severity
  }
}

/** Derives a prototype 5-tier frequency rating from an `Entry`'s existing signals. */
export const deriveEntryFrequencyTier = (
  entry: Pick<Entry, "common" | "frequency" | "labels">
): FrequencyTier | null => {
  const score = entry.frequency?.score ?? null
  if (entry.labels.some((label) => OLD_LABELS.includes(label.code)) || score === 1) {
    return "archaic"
  }
  if (score !== null && score <= 2) return "rare"
  if (score !== null && score >= 5) return "very_common"
  if (entry.frequency?.everyday === true && (score === null || score >= 5)) return "very_common"
  if (score === 4 || entry.common) return "common"
  if (score === 3) return "uncommon"
  return null
}

/** Prototype hero items led by the 5-tier frequency Snow Pebble, then loan chip, then non-redundant usage labels. */
export const protoHeroItems = (
  t: Strings,
  uiLanguage: Language,
  entry: Pick<Entry, "common" | "frequency" | "labels" | "language" | "loanLink">
): ReadonlyArray<ChipItem> => {
  const tier = deriveEntryFrequencyTier(entry)
  const freq = tier ? frequencyTierChip(uiLanguage, tier) : null
  const loan = loanChip(t, entry)
  const remainingLabels = freq ? withoutRedundantFrequencyLabels(entry.labels) : entry.labels
  return [...[freq, loan].filter((chip): chip is ChipItem => chip !== null), ...labelItems(t, remainingLabels)]
}

/** Fallback 5-tier frequency derivation for live `EntrySummary` rows until backend exposes `frequency` on search. */
export const deriveSummaryFrequencyTier = (
  entry: Pick<EntrySummary, "common" | "labels"> & { readonly frequencyTier?: FrequencyTier }
): FrequencyTier => {
  if (entry.frequencyTier) return entry.frequencyTier
  if (entry.labels.some((label) => OLD_LABELS.includes(label.code))) return "archaic"
  if (entry.labels.some((label) => label.code === "vulg" || label.code === "rare")) return "rare"
  if (entry.common) return "common"
  return "uncommon"
}
