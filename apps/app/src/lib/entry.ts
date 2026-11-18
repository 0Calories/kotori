import type {
  CautionKind,
  EnrichmentStatus,
  Entry,
  EntryCaution,
  EntryReview,
  Label,
  LabelCode,
  LabelSeverity,
  Sense,
  Source
} from "@kotori/contracts"
import type { Tone } from "../components/Chip.tsx"
import type { IconName } from "../components/Icon.tsx"
import type { Strings } from "../i18n/strings.ts"

export interface ChipItem {
  readonly key: string
  readonly label: string
  readonly help: string
  readonly severity: LabelSeverity
  readonly icon?: IconName
  readonly kotori?: boolean
}

export const labelItems = (t: Strings, labels: ReadonlyArray<Label>): ReadonlyArray<ChipItem> =>
  labels.map((label) => ({
    key: label.code,
    label: t.labels.name[label.code],
    help: label.source === "kotori" ? `${t.labels.help[label.code]} ✦ ${t.labels.kotori}` : t.labels.help[label.code],
    severity: label.severity,
    kotori: label.source === "kotori"
  }))

const LOUDNESS: Record<LabelSeverity, number> = { avoid: 0, warning: 1, info: 2, quiet: 3 }

export const resultLabels = (labels: ReadonlyArray<Label>, max = 2): ReadonlyArray<Label> =>
  labels
    .filter((label) => label.severity !== "quiet")
    .toSorted((a, b) => LOUDNESS[a.severity] - LOUDNESS[b.severity])
    .slice(0, max)

const OLD: ReadonlyArray<LabelCode> = ["arch", "obs"]

export const frequencyChip = (t: Strings, entry: Pick<Entry, "common" | "frequency" | "labels">): ChipItem | null => {
  const score = entry.frequency?.score ?? null
  if ((score !== null && score <= 2) || entry.labels.some((label) => OLD.includes(label.code))) {
    return { key: "rare", label: t.entry.rareWord, help: t.entry.rareHelp, severity: "warning" }
  }
  if (entry.common || entry.frequency?.everyday === true) {
    return {
      key: "common",
      label: t.entry.commonWord,
      help: t.entry.commonHelp,
      severity: "info",
      icon: "check_circle"
    }
  }
  return null
}

export const loanChip = (t: Strings, entry: Pick<Entry, "language" | "loanLink">): ChipItem | null =>
  entry.language === "en" && entry.loanLink?.meaning === "true_loanword"
    ? {
        key: "loan",
        label: t.entry.loanSame(entry.loanLink.katakana),
        help: t.entry.loanSameHelp(entry.loanLink.katakana),
        severity: "info",
        icon: "check",
        kotori: entry.loanLink.meaningSource === "kotori"
      }
    : null

export const loanLine = (t: Strings, entry: Pick<Entry, "language" | "loanLink">): string | null => {
  const link = entry.loanLink
  if (entry.language !== "ja" || link === null) return null
  switch (link.meaning) {
    case "true_loanword":
      return t.entry.loanFromSame(link.english)
    case "wasei_eigo":
      return t.entry.loanFromDiverged(link.english)
    case null:
      return t.entry.loanFrom(link.english)
  }
}

export const heroItems = (
  t: Strings,
  entry: Pick<Entry, "common" | "frequency" | "labels" | "language" | "loanLink">
) => [
  ...[frequencyChip(t, entry), loanChip(t, entry)].filter((chip): chip is ChipItem => chip !== null),
  ...labelItems(t, entry.labels)
]

export const wordCautions = (cautions: ReadonlyArray<EntryCaution>) =>
  cautions.filter((caution) => caution.sense === null)

export const senseCautions = (cautions: ReadonlyArray<EntryCaution>, sense: number) =>
  cautions.filter((caution) => caution.sense === sense)

interface Sourced {
  readonly source: Source
}

interface SourcedLoan extends Sourced {
  readonly meaningSource: Source | null
}

const loanFacts = (link: SourcedLoan | null | undefined): ReadonlyArray<Sourced> =>
  link ? [link, ...(link.meaningSource === null ? [] : [{ source: link.meaningSource }])] : []

interface SourcedFacts {
  readonly labels: ReadonlyArray<Sourced>
  readonly cautions: ReadonlyArray<Sourced>
  readonly loanLink?: SourcedLoan | null
  readonly senses: ReadonlyArray<{
    readonly labels: ReadonlyArray<Sourced>
    readonly usagePatterns: ReadonlyArray<Sourced>
  }>
}

export const hasKotoriMarks = (entry: SourcedFacts): boolean =>
  [
    ...entry.labels,
    ...entry.cautions,
    ...loanFacts(entry.loanLink),
    ...entry.senses.flatMap((sense) => [...sense.labels, ...sense.usagePatterns])
  ].some((fact) => fact.source === "kotori")

export const onItsWay = (status: EnrichmentStatus): boolean => {
  switch (status) {
    case "queued":
      return true
    case "ready":
    case "unrequested":
    case "unavailable":
      return false
  }
}

export const hasKotoriContent = (
  entry: Pick<Entry, "audioUrl" | "labels" | "loanLink" | "cautions" | "senses">
): boolean =>
  entry.audioUrl !== null ||
  hasKotoriMarks(entry) ||
  entry.senses.some((sense) => sense.examples.some((example) => example.source === "kotori"))

export const contributors = (
  t: Strings,
  entry: Pick<Entry, "source" | "labels" | "loanLink" | "cautions" | "senses">
): ReadonlyArray<string> => {
  const sources = new Set<Source>([entry.source])
  for (const fact of [
    ...entry.labels,
    ...entry.senses.flatMap((sense) => [...sense.labels, ...sense.usagePatterns, ...sense.examples]),
    ...entry.cautions,
    ...loanFacts(entry.loanLink)
  ]) {
    sources.add(fact.source)
  }
  return [...sources].map((source) => t.entry.sourceName[source])
}

export const similarWords = (senses: ReadonlyArray<Pick<Sense, "similarWords">>) => [
  ...new Map(senses.flatMap((sense) => sense.similarWords).map((word) => [word.entryId, word])).values()
]

export const CAUTION_ICON: Record<CautionKind, IconName> = {
  rude_upward: "work_off",
  keigo_direction: "swap_horiz",
  set_phrase: "forum",
  particle_pattern: "spellcheck",
  gendered_speech: "person",
  wasei_eigo: "error",
  textbook_english: "menu_book",
  directness: "forum",
  variety: "call_split",
  confusable: "call_split",
  collocation: "link",
  tone: "monitoring"
}

export interface ReviewMark {
  readonly chip: { readonly tone: Tone; readonly icon?: IconName; readonly label: string }
  readonly notice: { readonly tone: "primary" | "accent"; readonly message: string }
}

export const reviewMark = (t: Strings, review: EntryReview): ReviewMark | null => {
  switch (review) {
    case "approved":
      return null
    case "unreviewed":
      return {
        chip: { tone: "accent", icon: "auto_awesome", label: t.dictionary.askDraft },
        notice: { tone: "primary", message: t.entry.unverified }
      }
    case "discarded":
      return {
        chip: { tone: "neutral", label: t.entry.notAdded },
        notice: { tone: "accent", message: t.entry.notAdded }
      }
  }
}
