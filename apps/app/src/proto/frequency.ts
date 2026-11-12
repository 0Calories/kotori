import type { Entry, EntrySummary, LabelCode, Language } from "@kotori/contracts"
import { type ChipItem, labelItems, loanChip } from "../lib/entry.ts"
import type { Strings } from "../i18n/strings.ts"

/**
 * PROTOTYPE: Four-tier frequency model (`everyday` 4/4, `common` 3/4, `uncommon` 2/4, `rare` 1/4)
 * for entry headboards and search rows. Kept in `src/proto/` until `EntrySummary` and backend
 * frequency scoring are planned for the full feature.
 */
export type FrequencyTier = "everyday" | "common" | "uncommon" | "rare"

export const FREQUENCY_TIERS: ReadonlyArray<FrequencyTier> = ["everyday", "common", "uncommon", "rare"]

export const FREQUENCY_LEVEL: Record<FrequencyTier, 1 | 2 | 3 | 4> = {
  rare: 1,
  uncommon: 2,
  common: 3,
  everyday: 4
}

const FREQUENCY_COPY: Record<
  Language,
  Record<FrequencyTier, { readonly word: string; readonly short: string; readonly help: string }>
> = {
  en: {
    everyday: {
      word: "Everyday word",
      short: "Everyday",
      help: "Core everyday vocabulary — one of the words native speakers reach for first."
    },
    common: {
      word: "Common word",
      short: "Common",
      help: "Used regularly in conversation and writing."
    },
    uncommon: {
      word: "Uncommon word",
      short: "Uncommon",
      help: "Understood by native speakers, though heard less often in everyday talk — check whether a simpler word fits first."
    },
    rare: {
      word: "Rarely heard today",
      short: "Rare",
      help: "People recognise it, especially in formal writing, but seldom say it aloud."
    }
  },
  ja: {
    everyday: {
      word: "日常の基本語",
      short: "日常語",
      help: "ネイティブが毎日のように真っ先に使う基本的な言葉です。"
    },
    common: {
      word: "よく使う言葉",
      short: "よく使う",
      help: "日常会話や読み書きでよく使われる言葉です。"
    },
    uncommon: {
      word: "やや少なめ",
      short: "少なめ",
      help: "意味は通じますが、普段の会話ではやや聞く頻度が下がる言葉です。"
    },
    rare: {
      word: "今はあまり聞かない",
      short: "まれ",
      help: "意味は通じますが、日常ではめったに口にしません。まず覚えておきたい言葉です。"
    }
  }
}

const OLD_LABELS: ReadonlyArray<LabelCode> = ["arch", "obs"]

export const isFrequencyChipKey = (key: string): key is `freq:${FrequencyTier}` =>
  key === "freq:everyday" || key === "freq:common" || key === "freq:uncommon" || key === "freq:rare"

export const tierFromChipKey = (key: `freq:${FrequencyTier}`): FrequencyTier =>
  key.slice("freq:".length) as FrequencyTier

export const frequencyTierChip = (uiLanguage: Language, tier: FrequencyTier, variant: "word" | "short"): ChipItem => {
  const copy = FREQUENCY_COPY[uiLanguage][tier]
  const severity = tier === "rare" ? "warning" : tier === "uncommon" ? "quiet" : "info"
  return {
    key: `freq:${tier}`,
    label: variant === "word" ? copy.word : copy.short,
    help: copy.help,
    severity
  }
}

/** Derives a prototype 4-tier frequency rating from an `Entry`'s existing signals. */
export const deriveEntryFrequencyTier = (
  entry: Pick<Entry, "common" | "frequency" | "labels">
): FrequencyTier | null => {
  const score = entry.frequency?.score ?? null
  if ((score !== null && score <= 2) || entry.labels.some((label) => OLD_LABELS.includes(label.code))) {
    return "rare"
  }
  if (score !== null && score >= 5) return "everyday"
  if (entry.frequency?.everyday === true && (score === null || score >= 5)) return "everyday"
  if (score === 4 || entry.common) return "common"
  if (score === 3) return "uncommon"
  return null
}

/** Prototype hero items led by the 4-tier frequency Snow Pebble, then loan chip, then usage labels. */
export const protoHeroItems = (
  t: Strings,
  uiLanguage: Language,
  entry: Pick<Entry, "common" | "frequency" | "labels" | "language" | "loanLink">
): ReadonlyArray<ChipItem> => {
  const tier = deriveEntryFrequencyTier(entry)
  const freq = tier ? frequencyTierChip(uiLanguage, tier, "word") : null
  const loan = loanChip(t, entry)
  return [...[freq, loan].filter((chip): chip is ChipItem => chip !== null), ...labelItems(t, entry.labels)]
}

/** Fallback 4-tier frequency derivation for live `EntrySummary` rows until backend exposes `frequency` on search. */
export const deriveSummaryFrequencyTier = (
  entry: Pick<EntrySummary, "common" | "labels"> & { readonly frequencyTier?: FrequencyTier }
): FrequencyTier => {
  if (entry.frequencyTier) return entry.frequencyTier
  if (entry.labels.some((label) => OLD_LABELS.includes(label.code) || label.code === "vulg" || label.code === "rare")) {
    return "rare"
  }
  if (entry.common) return "common"
  return "uncommon"
}
