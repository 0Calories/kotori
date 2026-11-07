import type { Language, Source } from "@kotori/contracts"
import type { Strings } from "../i18n/strings.ts"

/**
 * Where an entry's Sources control goes. One target on web and native:
 * `/sources/123` is the URL and the stack screen, and `id` is the entry, so
 * the screen can name that word's dictionary and whatever was added to it.
 */
export const entrySourcesHref = (id: number) => ({ pathname: "/sources/[id]", params: { id: String(id) } }) as const

/** `useLocalSearchParams` may hand back a string or a one-element list. */
export const entryIdFromParam = (id: string | readonly string[] | undefined): number | null => {
  const raw = Array.isArray(id) ? id[0] : id
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** The parts of an entry the sources screen can credit. Narrower than `Entry`, which satisfies it. */
export interface SourcedEntry {
  readonly language: Language
  /** Where the senses came from; `kotori` for an Ask Kotori word a person approved. */
  readonly dictionary: Source
  readonly audioUrl: string | null
  readonly audio: ReadonlyArray<unknown>
  readonly labels: ReadonlyArray<{ readonly source: Source }>
  readonly pitfalls: ReadonlyArray<{ readonly source: Source }>
  readonly loanLink: { readonly source: Source } | null
  readonly senses: ReadonlyArray<{
    readonly labels: ReadonlyArray<{ readonly source: Source }>
    readonly patterns: ReadonlyArray<{ readonly source: Source }>
    readonly examples: ReadonlyArray<{
      readonly source: Source
      readonly audioUrl: string | null
      readonly translationAudioUrl: string | null
    }>
    readonly similarWords: ReadonlyArray<unknown>
  }>
}

export type AttributionId =
  | "dictionary"
  | "kotori"
  | "examples"
  | "tatoeba"
  | "wiktionary"
  | "similar"
  | "audio"
  | "loan"

export interface Attribution {
  readonly id: AttributionId
  readonly title: string
  readonly body: string
}

const hasAudio = (entry: SourcedEntry) =>
  entry.audioUrl !== null ||
  entry.audio.length > 0 ||
  entry.senses.some((sense) =>
    sense.examples.some((example) => example.audioUrl !== null || example.translationAudioUrl !== null)
  )

/**
 * Credits for this entry only: the dictionary it was taken from, then each added part that is
 * actually on the page. A dictionary-only word lists the dictionary and nothing else.
 */
export const entryAttributions = (t: Strings, entry: SourcedEntry): ReadonlyArray<Attribution> => {
  const senses = entry.senses
  const examples = senses.flatMap((sense) => sense.examples)
  const exampleFrom = (...sources: ReadonlyArray<Source>) =>
    examples.some((example) => sources.includes(example.source))
  const kotoriNotes = [
    ...entry.labels,
    ...entry.pitfalls,
    ...senses.flatMap((sense) => [...sense.labels, ...sense.patterns])
  ].some((fact) => fact.source === "kotori")
  const rows: Array<Attribution> = [
    {
      id: "dictionary",
      title: t.entry.sourceDictionary,
      body:
        entry.dictionary === "kotori"
          ? t.entry.sourceDictionaryKotori
          : entry.language === "ja"
            ? t.entry.sourceDictionaryJa
            : t.entry.sourceDictionaryEn
    }
  ]
  // An approved Ask Kotori word is Kotori's throughout, which the dictionary row already says.
  if (kotoriNotes && entry.dictionary !== "kotori") {
    rows.push({ id: "kotori", title: t.entry.sourceKotori, body: t.entry.sourceKotoriBody })
  }
  if (exampleFrom("kotori")) {
    rows.push({ id: "examples", title: t.entry.sourceExamples, body: t.entry.sourceExamplesBody })
  }
  if (exampleFrom("tatoeba")) {
    rows.push({ id: "tatoeba", title: t.entry.sourceTatoeba, body: t.entry.sourceTatoebaBody })
  }
  if (exampleFrom("jawiktionary", "enwiktionary")) {
    rows.push({ id: "wiktionary", title: t.entry.sourceWiktionary, body: t.entry.sourceWiktionaryBody })
  }
  if (senses.some((sense) => sense.similarWords.length > 0)) {
    rows.push({ id: "similar", title: t.entry.sourceSimilar, body: t.entry.sourceSimilarBody })
  }
  if (hasAudio(entry)) {
    rows.push({ id: "audio", title: t.entry.sourceAudio, body: t.entry.sourceAudioBody })
  }
  // A Japanese word's own dictionary names its loan; an English word's link comes from JMDict.
  if (entry.loanLink !== null && entry.loanLink.source !== entry.dictionary) {
    rows.push({
      id: "loan",
      title: t.entry.sourceLoan,
      body: entry.loanLink.source === "kotori" ? t.entry.sourceLoanKotori : t.entry.sourceLoanDictionary
    })
  }
  return rows
}
