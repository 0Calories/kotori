import type {
  Entry,
  Label,
  LabelCode,
  LabelSeverity,
  Pattern,
  PitfallKind,
  Sense,
  Source,
  WordPitfall
} from "@kotori/contracts"
import type { IconName } from "../components/Icon.tsx"
import type { Strings } from "../i18n/strings.ts"

// How the entry page reads the dictionary's model: label chips and what they explain, the usage
// and loan chips, pitfalls by scope, the Kotori mark, and the sources line. The Ask Kotori draft
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

/** Labels that make a word sound old: they earn the "rarely heard" chip whatever the counts say. */
const OLD: ReadonlyArray<LabelCode> = ["arch", "obs"]

/**
 * What the seeds say about how much the word is used, as one chip: "common" is the reassurance a
 * learner wants, "rarely heard" the surprise. Nothing is said for the middle, and silence does not
 * mean common.
 */
export const usageChip = (t: Strings, entry: Pick<Entry, "common" | "evidence" | "labels">): ChipItem | null => {
  const familiarity = entry.evidence?.familiarity ?? null
  if ((familiarity !== null && familiarity <= 2) || entry.labels.some((label) => OLD.includes(label.code))) {
    return { key: "rare", label: t.entry.rareWord, help: t.entry.rareHelp, severity: "caution" }
  }
  if (entry.common || entry.evidence?.everyday === true) {
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
 * drifted is a false-friend pitfall instead, and one nobody has judged says nothing.
 */
export const loanChip = (t: Strings, entry: Pick<Entry, "language" | "loanLink">): ChipItem | null =>
  entry.language === "en" && entry.loanLink?.meaning === "same"
    ? {
        key: "loan",
        label: t.entry.loanSame(entry.loanLink.katakana),
        help: t.entry.loanSameHelp(entry.loanLink.katakana),
        severity: "info",
        icon: "check",
        kotori: entry.loanLink.source === "kotori"
      }
    : null

/** On a katakana word, the English word it came from, and whether it still means that. */
export const loanLine = (t: Strings, entry: Pick<Entry, "language" | "loanLink">): string | null => {
  const link = entry.loanLink
  if (entry.language !== "ja" || link === null) return null
  switch (link.meaning) {
    case "same":
      return t.entry.loanFromSame(link.english)
    case "divergent":
      return t.entry.loanFromDiverged(link.english)
    case null:
      return t.entry.loanFrom(link.english)
  }
}

/** The hero's chips: how much the word is used, its loan, then its labels. */
export const heroItems = (
  t: Strings,
  entry: Pick<Entry, "common" | "evidence" | "labels" | "language" | "loanLink">
) => [
  ...[usageChip(t, entry), loanChip(t, entry)].filter((chip): chip is ChipItem => chip !== null),
  ...labelItems(t, entry.labels)
]

/** Pitfalls about the whole word, for the "watch out" card under the hero. */
export const wordPitfalls = (pitfalls: ReadonlyArray<WordPitfall>) =>
  pitfalls.filter((pitfall) => pitfall.sense === null)

/** Pitfalls about one sense, shown inside it. */
export const sensePitfalls = (pitfalls: ReadonlyArray<WordPitfall>, sense: number) =>
  pitfalls.filter((pitfall) => pitfall.sense === sense)

interface Sourced {
  readonly source: Source
}

/** The facts on a page that carry a source: the word's labels, pitfalls and loan, and each sense's. */
interface SourcedFacts {
  readonly labels: ReadonlyArray<Sourced>
  readonly pitfalls: ReadonlyArray<Sourced>
  readonly loanLink?: Sourced | null
  readonly senses: ReadonlyArray<{
    readonly labels: ReadonlyArray<Sourced>
    readonly patterns: ReadonlyArray<Sourced>
  }>
}

/** Whether anything on the page carries Kotori's ✦, so the legend explaining it is shown. */
export const hasKotoriMarks = (entry: SourcedFacts): boolean =>
  [
    ...entry.labels,
    ...entry.pitfalls,
    ...(entry.loanLink ? [entry.loanLink] : []),
    ...entry.senses.flatMap((sense) => [...sense.labels, ...sense.patterns])
  ].some((fact) => fact.source === "kotori")

/**
 * Whether Kotori has added anything to the word: its own sentences, audio, or a label, note or
 * pitfall. A word with none is the dictionary's alone, and the page offers to ask for more.
 */
export const hasKotoriContent = (
  entry: Pick<Entry, "audioUrl" | "labels" | "loanLink" | "pitfalls" | "senses">
): boolean =>
  entry.audioUrl !== null ||
  hasKotoriMarks(entry) ||
  entry.senses.some((sense) => sense.examples.some((example) => example.source === "kotori"))

/** Who contributed to the page, dictionary first, for the sources line under it. */
export const contributors = (
  t: Strings,
  entry: Pick<Entry, "dictionary" | "labels" | "loanLink" | "pitfalls" | "senses">
): ReadonlyArray<string> => {
  const sources = new Set<Source>([entry.dictionary])
  for (const fact of [
    ...entry.labels,
    ...entry.senses.flatMap((sense) => [...sense.labels, ...sense.patterns, ...sense.examples]),
    ...entry.pitfalls,
    ...(entry.loanLink === null ? [] : [entry.loanLink])
  ]) {
    sources.add(fact.source)
  }
  return [...sources].map((source) => t.entry.sourceName[source])
}

/** The words a page links to from its similar-words list: each once, in sense order. */
export const similarWords = (senses: ReadonlyArray<Pick<Sense, "similarWords">>) => [
  ...new Map(senses.flatMap((sense) => sense.similarWords).map((word) => [word.entryId, word])).values()
]

/** Pitfall kind icons: the trap's shape at a glance. */
export const PITFALL_ICON: Record<PitfallKind, IconName> = {
  rude_upward: "work_off",
  keigo_direction: "swap_horiz",
  set_phrase: "forum",
  particle_pattern: "spellcheck",
  gendered_speech: "person",
  false_friend: "error",
  textbook_english: "menu_book",
  directness: "forum",
  variety: "call_split",
  confusable: "call_split",
  collocation: "link"
}

/**
 * What a saved word carries to its review card: the register worth a hint (the labels that
 * aren't grammar facts, word's then the sense's), and the one note most worth remembering: a
 * pitfall on that sense or the word, else its first usage note.
 */
export const saveDetails = (
  t: Strings,
  entry: Pick<Entry, "labels" | "pitfalls">,
  sense: Pick<Sense, "index" | "labels" | "patterns">
): { readonly hint: string | null; readonly note: string | null } => {
  const hint = [...entry.labels, ...sense.labels]
    .filter((label) => label.severity !== "quiet")
    .map((label) => t.labels.name[label.code])
    .join(" · ")
  const pitfall = sensePitfalls(entry.pitfalls, sense.index)[0] ?? wordPitfalls(entry.pitfalls)[0]
  const pattern: Pattern | undefined = sense.patterns[0]
  return { hint: hint.length > 0 ? hint : null, note: pitfall?.text ?? pattern?.text ?? null }
}
