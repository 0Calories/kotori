import type {
  CautionKind,
  Entry,
  EntryCaution,
  Label,
  LabelCode,
  LabelSeverity,
  Sense,
  Source,
  UsagePattern
} from "@kotori/contracts"
import type { IconName } from "../components/Icon.tsx"
import type { Strings } from "../i18n/strings.ts"

// How the entry page reads the dictionary's model: label chips and what they explain, the frequency
// and loan chips, cautions by scope, the Kotori mark, and the sources line. The Ask Kotori draft
// is read the same way.

/**
 * A chip that explains itself on tap: a label, or a fact about the word that isn't one (it is
 * common, its katakana loan means the same). Its severity sets how loudly it speaks.
 */
export interface ChipItem {
  readonly key: string
  readonly label: string
  /** The sentence behind the chip, shown under its row. */
  readonly help: string
  readonly severity: LabelSeverity
  readonly icon?: IconName
  /** Added by Kotori's AI rather than taken from a dictionary: the chip carries the ✦ mark. */
  readonly kotori?: boolean
}

/** Labels as chips, in the interface language; Kotori's say so in their explanation. */
export const labelItems = (t: Strings, labels: ReadonlyArray<Label>): ReadonlyArray<ChipItem> =>
  labels.map((label) => ({
    key: label.code,
    label: t.labels.name[label.code],
    help: label.source === "kotori" ? `${t.labels.help[label.code]} ✦ ${t.labels.kotori}` : t.labels.help[label.code],
    severity: label.severity,
    kotori: label.source === "kotori"
  }))

/** How loudly each severity speaks, loudest first. */
const LOUDNESS: Record<LabelSeverity, number> = { avoid: 0, warning: 1, info: 2, quiet: 3 }

/**
 * The word's labels worth a chip in a search result, loudest first: at most `max`, and never a
 * quiet one (a grammar fact such as "idiom" can wait for the entry). A row stays quiet: vulgar,
 * archaic or casual before respectful or British.
 */
export const resultLabels = (labels: ReadonlyArray<Label>, max = 2): ReadonlyArray<Label> =>
  labels
    .filter((label) => label.severity !== "quiet")
    .toSorted((a, b) => LOUDNESS[a.severity] - LOUDNESS[b.severity])
    .slice(0, max)

/** Labels that make a word sound old: they earn the "rarely heard" chip whatever the counts say. */
const OLD: ReadonlyArray<LabelCode> = ["arch", "obs"]

/**
 * What the sources say about how often the word is used, as one chip: "common" is the reassurance a
 * learner wants, "rarely heard" the surprise. Nothing is said for the middle, and silence does not
 * mean common.
 */
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

/**
 * On an English word whose katakana loan kept its meaning, a quiet chip says so. A loan that
 * drifted is a wasei-eigo caution instead, and one nobody has judged says nothing.
 */
export const loanChip = (t: Strings, entry: Pick<Entry, "language" | "loanLink">): ChipItem | null =>
  entry.language === "en" && entry.loanLink?.meaning === "true_loanword"
    ? {
        key: "loan",
        label: t.entry.loanSame(entry.loanLink.katakana),
        help: t.entry.loanSameHelp(entry.loanLink.katakana),
        severity: "info",
        icon: "check",
        // The chip is the verdict, so its mark is whoever judged the meaning.
        kotori: entry.loanLink.meaningSource === "kotori"
      }
    : null

/** On a katakana word, the English word it came from, and whether it still means that. */
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

/** The hero's chips: how often the word is used, its loan, then its labels. */
export const heroItems = (
  t: Strings,
  entry: Pick<Entry, "common" | "frequency" | "labels" | "language" | "loanLink">
) => [
  ...[frequencyChip(t, entry), loanChip(t, entry)].filter((chip): chip is ChipItem => chip !== null),
  ...labelItems(t, entry.labels)
]

/** Cautions about the whole word, for the "Cautions" card under the hero. */
export const wordCautions = (cautions: ReadonlyArray<EntryCaution>) =>
  cautions.filter((caution) => caution.sense === null)

/** Cautions about one sense, shown inside it. */
export const senseCautions = (cautions: ReadonlyArray<EntryCaution>, sense: number) =>
  cautions.filter((caution) => caution.sense === sense)

interface Sourced {
  readonly source: Source
}

/** A loan link: who named the pair, and who judged its meaning. */
interface SourcedLoan extends Sourced {
  readonly meaningSource: Source | null
}

/** A loan link's facts with a source: the pair, and its verdict when there is one. */
const loanFacts = (link: SourcedLoan | null | undefined): ReadonlyArray<Sourced> =>
  link ? [link, ...(link.meaningSource === null ? [] : [{ source: link.meaningSource }])] : []

/** The facts on a page that carry a source: the word's labels, cautions and loan, and each sense's. */
interface SourcedFacts {
  readonly labels: ReadonlyArray<Sourced>
  readonly cautions: ReadonlyArray<Sourced>
  readonly loanLink?: SourcedLoan | null
  readonly senses: ReadonlyArray<{
    readonly labels: ReadonlyArray<Sourced>
    readonly usagePatterns: ReadonlyArray<Sourced>
  }>
}

/** Whether anything on the page carries Kotori's ✦, so the legend explaining it is shown. */
export const hasKotoriMarks = (entry: SourcedFacts): boolean =>
  [
    ...entry.labels,
    ...entry.cautions,
    ...loanFacts(entry.loanLink),
    ...entry.senses.flatMap((sense) => [...sense.labels, ...sense.usagePatterns])
  ].some((fact) => fact.source === "kotori")

/**
 * Whether Kotori has added anything to the word: its own sentences, audio, or a label, note or
 * caution. A word with none is the dictionary's alone, and the page offers to ask for more.
 */
export const hasKotoriContent = (
  entry: Pick<Entry, "audioUrl" | "labels" | "loanLink" | "cautions" | "senses">
): boolean =>
  entry.audioUrl !== null ||
  hasKotoriMarks(entry) ||
  entry.senses.some((sense) => sense.examples.some((example) => example.source === "kotori"))

/** Who contributed to the page, primary source first, for the sources line under it. */
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

/** The words a page links to from its similar-words list: each once, in sense order. */
export const similarWords = (senses: ReadonlyArray<Pick<Sense, "similarWords">>) => [
  ...new Map(senses.flatMap((sense) => sense.similarWords).map((word) => [word.entryId, word])).values()
]

/** Caution kind icons: the caution's shape at a glance. */
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

/**
 * What a saved word carries into its reviews: the usage labels worth a hint (the labels that
 * aren't grammar facts, word's then the sense's), and the one note most worth remembering: a
 * caution on that sense or the word, else its first usage pattern.
 */
export const saveDetails = (
  t: Strings,
  entry: Pick<Entry, "labels" | "cautions">,
  sense: Pick<Sense, "index" | "labels" | "usagePatterns">
): { readonly hint: string | null; readonly note: string | null } => {
  const hint = [...entry.labels, ...sense.labels]
    .filter((label) => label.severity !== "quiet")
    .map((label) => t.labels.name[label.code])
    .join(" · ")
  const caution = senseCautions(entry.cautions, sense.index)[0] ?? wordCautions(entry.cautions)[0]
  const usagePattern: UsagePattern | undefined = sense.usagePatterns[0]
  return { hint: hint.length > 0 ? hint : null, note: caution?.text ?? usagePattern?.text ?? null }
}
